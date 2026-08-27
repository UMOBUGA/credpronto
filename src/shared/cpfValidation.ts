/**
 * Checksum padrão de CPF (módulo 11) — mesma lógica de `api/_lib/cpfValidation.ts`,
 * duplicada aqui porque o frontend não pode importar de `api/_lib` (bundles
 * separados, ver CLAUDE.md). Usada em `NewApplicationPage.tsx` pra barrar um
 * CPF com formato errado antes de gastar uma requisição — o backend
 * continua sendo a fonte de verdade (não confia só na validação do
 * cliente), isto é só feedback mais rápido.
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
