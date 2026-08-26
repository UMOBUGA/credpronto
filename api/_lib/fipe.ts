const FIPE_BASE = 'https://brasilapi.com.br/api/fipe'
const VEHICLE_TYPE = 'carros'

interface FipeBrand {
  nome: string
  valor: string
}
interface FipeModelOption {
  modelo: string
  valor: string
}
interface FipeYearOption {
  nome: string
  valor: string
}
interface FipeDetails {
  valor: string
  marca: string
  modelo: string
  anoModelo: number
  codigoFipe: string
}

export interface FipeLookupResult {
  fipeValue: number | null
  fipeCode: string | null
  fipeBrand: string | null
  fipeModel: string | null
  fipeYear: string | null
}

const EMPTY_RESULT: FipeLookupResult = {
  fipeValue: null,
  fipeCode: null,
  fipeBrand: null,
  fipeModel: null,
  fipeYear: null,
}

/**
 * Cadeia real da BrasilAPI confirmada lendo o código-fonte do projeto
 * (`marcas` → `veiculos` → `anos` → `detalhes`), gratuita e sem chave.
 * Marcas/modelos mudam raramente — cacheados em memória de processo pra não
 * martelar a API a cada chamada.
 */
const brandsCache = new Map<string, FipeBrand[]>()
const modelsCache = new Map<string, FipeModelOption[]>()

/** Só pra testes — o cache em produção nunca precisa ser limpo. */
export function resetFipeCache(): void {
  brandsCache.clear()
  modelsCache.clear()
}

function normalize(value: string): string {
  return value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function findBestMatch<T>(items: T[], label: (item: T) => string, query: string): T | null {
  const normalizedQuery = normalize(query)
  const exact = items.find((item) => normalize(label(item)) === normalizedQuery)
  if (exact) return exact
  return (
    items.find(
      (item) =>
        normalize(label(item)).includes(normalizedQuery) ||
        normalizedQuery.includes(normalize(label(item))),
    ) ?? null
  )
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`BrasilAPI FIPE respondeu ${res.status} em ${url}`)
  }
  return (await res.json()) as T
}

async function getBrands(): Promise<FipeBrand[]> {
  const cached = brandsCache.get(VEHICLE_TYPE)
  if (cached) return cached
  const brands = await fetchJson<FipeBrand[]>(`${FIPE_BASE}/marcas/v1/${VEHICLE_TYPE}`)
  brandsCache.set(VEHICLE_TYPE, brands)
  return brands
}

async function getModels(brandCode: string): Promise<FipeModelOption[]> {
  const cached = modelsCache.get(brandCode)
  if (cached) return cached
  const models = await fetchJson<FipeModelOption[]>(
    `${FIPE_BASE}/veiculos/v1/${VEHICLE_TYPE}/${brandCode}`,
  )
  modelsCache.set(brandCode, models)
  return models
}

/** "R$ 45.678,00" -> 45678 — o upstream da FIPE devolve preço como string formatada. */
function parseCurrency(value: string): number | null {
  const normalized = value.replace(/[^\d,]/g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && normalized !== '' ? parsed : null
}

/**
 * Enriquecimento, nunca bloqueante: a loja digita marca/modelo como texto
 * livre (não os códigos da FIPE), então cada etapa usa melhor-correspondência
 * por nome normalizado. Sem correspondência em qualquer etapa, ou a API fora
 * do ar, devolve tudo `null` — o motor de decisão trata "sem dado FIPE" como
 * neutro, nunca como erro que trava a esteira.
 */
export async function lookupFipeValue(
  vehicleMake: string,
  vehicleModel: string,
  vehicleYear: number,
): Promise<FipeLookupResult> {
  try {
    const brands = await getBrands()
    const brand = findBestMatch(brands, (b) => b.nome, vehicleMake)
    if (!brand) return EMPTY_RESULT

    const models = await getModels(brand.valor)
    const model = findBestMatch(models, (m) => m.modelo, vehicleModel)
    if (!model) return EMPTY_RESULT

    const years = await fetchJson<FipeYearOption[]>(
      `${FIPE_BASE}/anos/v1/${VEHICLE_TYPE}/${brand.valor}/${model.valor}`,
    )
    const yearMatch = years.find((y) => y.nome.startsWith(String(vehicleYear))) ?? years[0]
    if (!yearMatch) return EMPTY_RESULT

    const details = await fetchJson<FipeDetails>(
      `${FIPE_BASE}/detalhes/v1/${VEHICLE_TYPE}/${brand.valor}/${model.valor}/${yearMatch.valor}`,
    )

    return {
      fipeValue: parseCurrency(details.valor),
      fipeCode: details.codigoFipe,
      fipeBrand: details.marca,
      fipeModel: details.modelo,
      fipeYear: String(details.anoModelo),
    }
  } catch {
    return EMPTY_RESULT
  }
}
