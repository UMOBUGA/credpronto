import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const LOCAL_DIR = path.resolve('.data/uploads')

export interface StoredFile {
  storageKey: string
}

/**
 * Mesmo padrão de `db.ts`: a implementação é escolhida pela presença de uma
 * env var (`BLOB_READ_WRITE_TOKEN`), não por config manual. Sem ela, salva
 * em `.data/uploads/` local — zero configuração para desenvolver.
 *
 * Limitação conhecida (documentada, não corrigida aqui): o Vercel Blob atual
 * exige `access: 'public'` — o arquivo fica acessível por quem tiver a URL
 * (aleatória e não listada publicamente), não realmente privado. Para dado
 * tão sensível quanto RG/CPF isso seria substituído por um bucket privado
 * com URL assinada numa versão de produção real; aqui é um limite de escopo
 * de portfólio, igual à `ENCRYPTION_KEY` única em vez de KMS (ver
 * `crypto.ts`).
 */
export async function putDocument(buffer: Buffer, extension: string): Promise<StoredFile> {
  return process.env.BLOB_READ_WRITE_TOKEN
    ? putBlob(buffer, extension)
    : putLocal(buffer, extension)
}

export async function getDocument(storageKey: string): Promise<Buffer> {
  return process.env.BLOB_READ_WRITE_TOKEN ? getBlob(storageKey) : getLocal(storageKey)
}

async function putLocal(buffer: Buffer, extension: string): Promise<StoredFile> {
  await mkdir(LOCAL_DIR, { recursive: true })
  const storageKey = `${randomUUID()}${extension}`
  await writeFile(path.join(LOCAL_DIR, storageKey), buffer)
  return { storageKey }
}

async function getLocal(storageKey: string): Promise<Buffer> {
  return readFile(path.join(LOCAL_DIR, storageKey))
}

async function putBlob(buffer: Buffer, extension: string): Promise<StoredFile> {
  const { put } = await import('@vercel/blob')
  const key = `${randomUUID()}${extension}`
  const result = await put(key, buffer, { access: 'public', addRandomSuffix: false })
  return { storageKey: result.url }
}

async function getBlob(storageKey: string): Promise<Buffer> {
  const res = await fetch(storageKey)
  if (!res.ok) throw new Error(`Falha ao buscar documento no Blob: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}
