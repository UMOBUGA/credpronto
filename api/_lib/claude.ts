import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { DocumentType } from './schema'
import type { DecisionOutcome, DecisionResult } from './decision'

const MODEL = 'claude-opus-5'

let client: Anthropic | null = null

/**
 * Client lazy — só é criado na primeira chamada, então um projeto sem
 * `ANTHROPIC_API_KEY` configurada continua rodando (dev, testes, build);
 * o erro só aparece quando algo de fato tenta chamar a IA, e nesse ponto
 * `documentExtraction.ts`/`riskNarrative.ts` já sabem transformar isso num
 * status recuperável em vez de derrubar a requisição.
 */
function getClient(): Anthropic {
  client ??= new Anthropic()
  return client
}

export class ClaudeToolCallError extends Error {
  code: 'no_tool_use' | 'invalid_output' | 'api_error'
  constructor(code: ClaudeToolCallError['code'], message: string) {
    super(message)
    this.name = 'ClaudeToolCallError'
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// Extração de documento (Fase 2)
// ---------------------------------------------------------------------------

const EXTRACTION_TOOL_NAME = 'extract_document_fields'

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: EXTRACTION_TOOL_NAME,
  description:
    'Registra os campos extraídos de um documento brasileiro (RG, CPF, CNH, comprovante de renda ou de residência) a partir da imagem fornecida.',
  input_schema: {
    type: 'object',
    properties: {
      fields: {
        type: 'object',
        description:
          'Mapa de nome do campo (em português, camelCase, ex.: "nome", "cpf", "dataNascimento", "rendaMensalDeclarada", "endereco") para o valor extraído em texto. Inclua só os campos que estiverem legíveis na imagem — nunca invente um valor.',
        additionalProperties: { type: 'string' },
      },
      confidence: {
        type: 'number',
        description: 'Confiança geral na extração, de 0 (nenhuma) a 1 (total).',
      },
      issues: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Problemas encontrados, se houver (ex.: "imagem borrada", "CPF ilegível", "documento não parece ser do tipo esperado"). Lista vazia se não houver problema.',
      },
    },
    required: ['fields', 'confidence', 'issues'],
  },
}

const EXTRACTION_SYSTEM_PROMPT =
  'Você é um assistente que extrai dados estruturados de documentos de identificação e comprovantes brasileiros a partir de uma imagem. Nunca invente informação que não esteja visível na imagem — se um campo não estiver legível, omita-o de "fields" e registre o motivo em "issues". Sempre responda usando a ferramenta disponível, nunca em texto livre.'

const EXPECTED_FIELDS: Record<DocumentType, string> = {
  rg: 'nome, cpf, dataNascimento',
  cpf: 'nome, cpf',
  cnh: 'nome, cpf, dataNascimento',
  comprovante_renda: 'nome, rendaMensalDeclarada',
  comprovante_residencia: 'nome, endereco',
}

const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

const extractionResultSchema = z.object({
  fields: z.record(z.string(), z.string()),
  confidence: z.number().min(0).max(1),
  issues: z.array(z.string()),
})

export interface DocumentExtractionResult {
  fields: Record<string, string>
  confidence: number
  issues: string[]
  modelUsed: string
}

export async function extractDocument(
  fileBase64: string,
  mimeType: string,
  documentType: DocumentType,
): Promise<DocumentExtractionResult> {
  const prompt = `A imagem em anexo deveria ser um documento do tipo "${documentType}". Extraia os seguintes campos, se estiverem legíveis: ${EXPECTED_FIELDS[documentType]}. "confidence" deve refletir sua confiança geral na extração.`

  const fileBlock: Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam =
    SUPPORTED_IMAGE_TYPES.has(mimeType)
      ? {
          type: 'image',
          source: { type: 'base64', media_type: mimeType as 'image/jpeg', data: fileBase64 },
        }
      : {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 },
        }

  let response: Anthropic.Message
  try {
    response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: EXTRACTION_SYSTEM_PROMPT,
      tools: [EXTRACTION_TOOL],
      messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: prompt }] }],
    })
  } catch (error) {
    throw new ClaudeToolCallError(
      'api_error',
      error instanceof Error ? error.message : 'Erro desconhecido ao chamar a API da Anthropic',
    )
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  )
  if (!toolUse) {
    throw new ClaudeToolCallError('no_tool_use', 'O modelo não retornou uma extração estruturada.')
  }

  const parsed = extractionResultSchema.safeParse(toolUse.input)
  if (!parsed.success) {
    throw new ClaudeToolCallError(
      'invalid_output',
      `A extração retornada não bateu com o formato esperado: ${parsed.error.message}`,
    )
  }

  return { ...parsed.data, modelUsed: response.model }
}

// ---------------------------------------------------------------------------
// Parecer de risco (Fase 4)
// ---------------------------------------------------------------------------

const NARRATIVE_TOOL_NAME = 'write_risk_narrative'

const NARRATIVE_TOOL: Anthropic.Tool = {
  name: NARRATIVE_TOOL_NAME,
  description:
    'Registra o parecer de risco de uma decisão de crédito automotivo já tomada, em duas versões.',
  input_schema: {
    type: 'object',
    properties: {
      dealerNarrative: {
        type: 'string',
        description:
          'Parecer técnico para a equipe da loja: cite os números e fatores relevantes que levaram à decisão (score, renda, restrições, LTV, sinais de fraude).',
      },
      applicantNarrative: {
        type: 'string',
        description:
          'Explicação em linguagem simples, clara e respeitosa para o comprador — sem jargão técnico, sem números de score internos.',
      },
    },
    required: ['dealerNarrative', 'applicantNarrative'],
  },
}

const NARRATIVE_SYSTEM_PROMPT =
  'Você é um assistente que explica decisões de crédito automotivo já tomadas por um motor de regras determinístico. Você nunca decide nada — a decisão já foi tomada antes de você ser chamado; sua única função é explicá-la com clareza a partir dos fatores fornecidos. Nunca invente um fator que não esteja nos dados. Nunca dê conselhos financeiros, nunca prometa aprovação futura, nunca sugira formas de burlar os critérios. Sempre responda usando a ferramenta disponível, nunca em texto livre.'

const narrativeResultSchema = z.object({
  dealerNarrative: z.string().min(1),
  applicantNarrative: z.string().min(1),
})

export interface NarrativeResult {
  dealerNarrative: string
  applicantNarrative: string
}

const OUTCOME_LABELS: Record<DecisionOutcome, string> = {
  approved: 'aprovada',
  denied: 'negada',
  manual_review: 'encaminhada para revisão manual (aguardando decisão humana)',
}

function formatCurrencyBr(value: number): string {
  return `R$ ${value.toFixed(2)}`
}

function buildNarrativePrompt(
  factors: DecisionResult['factors'],
  outcome: DecisionOutcome,
): string {
  const lines = [
    `A proposta de crédito foi ${OUTCOME_LABELS[outcome]}.`,
    `Score do bureau de crédito (simulado): ${factors.bureauScore}.`,
    `Bureau reporta restrição: ${factors.hasBureauRestriction ? 'sim' : 'não'}.`,
    `Valor solicitado: ${formatCurrencyBr(factors.requestedAmount)} em ${factors.requestedTermMonths}x.`,
    `Renda mensal declarada: ${formatCurrencyBr(factors.monthlyIncomeDeclared)}.`,
    `Comprometimento de renda (prestação ÷ renda): ${(factors.debtToIncome * 100).toFixed(1)}%.`,
    `Veículo com restrição de roubo/furto/gravame (consulta simulada): ${factors.vehicleRestrictionFound ? 'sim' : 'não'}.`,
    factors.fipeValue != null
      ? `Valor de mercado do veículo (tabela FIPE): ${formatCurrencyBr(factors.fipeValue)}${
          factors.loanToValue != null
            ? ` — o financiamento pede ${(factors.loanToValue * 100).toFixed(1)}% desse valor`
            : ''
        }.`
      : 'Valor de mercado do veículo (tabela FIPE): não disponível.',
    `Score de risco de anti-fraude: ${factors.antifraudRiskScore}/100${
      factors.antifraudFlags.length > 0
        ? `, sinais encontrados: ${factors.antifraudFlags.join(', ')}`
        : ', sem sinais encontrados'
    }.`,
  ]
  return lines.join('\n')
}

/**
 * Roda **depois** do motor determinístico (`decision.ts::decide`) já ter
 * decidido — nunca decide nada, só explica uma decisão já tomada a partir
 * de `factors`. Essa fronteira é deliberada: auditabilidade e
 * responsabilidade exigem que a decisão em si nunca dependa de uma
 * chamada de IA.
 */
export async function generateNarrative(
  factors: DecisionResult['factors'],
  outcome: DecisionOutcome,
): Promise<NarrativeResult> {
  const prompt = buildNarrativePrompt(factors, outcome)

  let response: Anthropic.Message
  try {
    response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: NARRATIVE_SYSTEM_PROMPT,
      tools: [NARRATIVE_TOOL],
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (error) {
    throw new ClaudeToolCallError(
      'api_error',
      error instanceof Error ? error.message : 'Erro desconhecido ao chamar a API da Anthropic',
    )
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  )
  if (!toolUse) {
    throw new ClaudeToolCallError('no_tool_use', 'O modelo não retornou um parecer estruturado.')
  }

  const parsed = narrativeResultSchema.safeParse(toolUse.input)
  if (!parsed.success) {
    throw new ClaudeToolCallError(
      'invalid_output',
      `O parecer retornado não bateu com o formato esperado: ${parsed.error.message}`,
    )
  }

  return parsed.data
}
