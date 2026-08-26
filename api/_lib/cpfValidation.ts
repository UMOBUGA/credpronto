/**
 * Checksum padrão de CPF (módulo 11) — roda em cima do que o modelo de IA
 * extrai de um documento (Fase 2), nunca substitui a extração. Um CPF com
 * dígito verificador inválido força revisão manual mesmo que a IA reporte
 * confiança alta.
 */
export function isValidCpf(rawCpf: string): boolean {
  const cpf = rawCpf.replace(/\D/g, '')
  if (cpf.length !== 11) return false
  if (/^(\d)\1{10}$/.test(cpf)) return false

  const digits = cpf.split('').map(Number)

  function checkDigit(length: number): number {
    let sum = 0
    for (let i = 0; i < length; i++) {
      sum += digits[i]! * (length + 1 - i)
    }
    const remainder = (sum * 10) % 11
    return remainder === 10 ? 0 : remainder
  }

  return checkDigit(9) === digits[9] && checkDigit(10) === digits[10]
}
