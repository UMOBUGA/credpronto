import { isValidCpf } from './cpfValidation'

describe('isValidCpf', () => {
  it('aceita um CPF com dígitos verificadores corretos', () => {
    expect(isValidCpf('390.533.447-05')).toBe(true)
    expect(isValidCpf('39053344705')).toBe(true)
  })

  it('rejeita um CPF com dígito verificador errado', () => {
    expect(isValidCpf('39053344706')).toBe(false)
  })

  it('rejeita sequências de dígitos repetidos', () => {
    expect(isValidCpf('11111111111')).toBe(false)
  })

  it('rejeita entradas com tamanho errado', () => {
    expect(isValidCpf('123')).toBe(false)
    expect(isValidCpf('')).toBe(false)
  })
})
