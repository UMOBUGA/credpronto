import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { auditLog } from './schema'
import { decryptField, encryptField, hashForLookup } from './crypto'

describe('encryptField / decryptField', () => {
  it('round-trips um valor em claro', async () => {
    const db = await getDb()
    const ciphertext = encryptField('valor secreto')
    expect(ciphertext).not.toBe('valor secreto')

    const plaintext = await decryptField(ciphertext, {
      db,
      actor: { actorType: 'system' },
      entityType: 'test',
      entityId: 'roundtrip',
      field: 'value',
    })
    expect(plaintext).toBe('valor secreto')
  })

  it('grava uma linha em audit_log ao decriptar', async () => {
    const db = await getDb()
    const ciphertext = encryptField('outro valor')

    await decryptField(ciphertext, {
      db,
      actor: { actorType: 'system' },
      entityType: 'test',
      entityId: 'audit-check',
      field: 'value',
    })

    const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, 'audit-check'))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.action).toBe('pii.decrypted')
  })

  it('produz ciphertexts diferentes pro mesmo valor (IV aleatório)', () => {
    expect(encryptField('mesmo valor')).not.toBe(encryptField('mesmo valor'))
  })

  it('rejeita um payload malformado', async () => {
    const db = await getDb()
    await expect(
      decryptField('nao-e-um-payload-valido', {
        db,
        actor: { actorType: 'system' },
        entityType: 'test',
        entityId: 'malformed',
        field: 'value',
      }),
    ).rejects.toThrow()
  })
})

describe('hashForLookup', () => {
  it('é determinístico', () => {
    expect(hashForLookup('12345678900')).toBe(hashForLookup('12345678900'))
  })

  it('produz hashes diferentes pra valores diferentes', () => {
    expect(hashForLookup('12345678900')).not.toBe(hashForLookup('00987654321'))
  })
})
