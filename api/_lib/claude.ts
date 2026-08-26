import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { DocumentType } from './schema'

const MODEL = 'claude-opus-5'

let client: Anthropic | null = null

/**
 * Client lazy — só é criado na primeira chamada, então um projeto sem
 * `ANTHROPIC_API_KEY` configurada continua rodando (dev, testes, build);
 * o erro só aparece quando algo de fato tenta extrair um documento, e nesse
 * ponto `documentExtraction.ts` já sabe transformar isso num status
 * `failed` recuperável em vez de derrubar a requisição.
 */
function getClient(): Anthropic {
  client ??= new Anthropic()
  return client
}

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

const SYSTEM_PROMPT =
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

export class ExtractionError extends Error {
  code: 'no_tool_use' | 'invalid_output' | 'api_error'
  constructor(code: ExtractionError['code'], message: string) {
    super(message)
    this.name = 'ExtractionError'
    this.code = code
  }
}

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
      system: SYSTEM_PROMPT,
      tools: [EXTRACTION_TOOL],
      messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: prompt }] }],
    })
  } catch (error) {
    throw new ExtractionError(
      'api_error',
      error instanceof Error ? error.message : 'Erro desconhecido ao chamar a API da Anthropic',
    )
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  )
  if (!toolUse) {
    throw new ExtractionError('no_tool_use', 'O modelo não retornou uma extração estruturada.')
  }

  const parsed = extractionResultSchema.safeParse(toolUse.input)
  if (!parsed.success) {
    throw new ExtractionError(
      'invalid_output',
      `A extração retornada não bateu com o formato esperado: ${parsed.error.message}`,
    )
  }

  return { ...parsed.data, modelUsed: response.model }
}
