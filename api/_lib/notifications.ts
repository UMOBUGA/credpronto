import type { Db } from './db'
import { notificationLog } from './schema'

export type NotificationTemplate = 'link_sent' | 'decision_ready' | 'offer_created'

export interface NotificationClient {
  send(db: Db, applicationId: string, template: NotificationTemplate): Promise<void>
}

/**
 * Sem nenhum provedor de e-mail configurado — não faria sentido exigir um
 * pra projeto de portfólio. Só loga no console e grava a linha em
 * `notification_log`; nunca guarda destinatário/conteúdo (ver comentário em
 * `schema.ts`). Mesmo espírito de `checkBureauMock`/`MockOpenFinanceClient`:
 * side effect observável, sem chamada de rede real.
 */
export class MockNotificationClient implements NotificationClient {
  async send(db: Db, applicationId: string, template: NotificationTemplate): Promise<void> {
    console.log(`[mock-email] ${template} — proposta ${applicationId}`)
    await db.insert(notificationLog).values({
      applicationId,
      channel: 'email',
      template,
      status: 'sent',
    })
  }
}

/**
 * Ponto de extensão documentado, nunca exercitado de verdade — mesmo padrão
 * de `RealOpenFinanceClient`. Diferente do Open Finance, mandar e-mail de
 * verdade não esbarra em nenhuma barreira regulatória (um provedor como
 * Resend/SendGrid resolveria), só está fora do escopo deste projeto de
 * portfólio: exigiria uma chave de API própria do usuário e um domínio
 * verificado, o que este repositório não tem como assumir por padrão.
 */
export class RealNotificationClient implements NotificationClient {
  async send(): Promise<void> {
    throw new Error(
      'RealNotificationClient não está implementado — nenhum provedor de e-mail ' +
        '(ex.: Resend, SendGrid) está configurado para este projeto de portfólio. Defina ' +
        'NOTIFICATIONS_ENABLED=false (ou omita) para usar o mock.',
    )
  }
}

export function getNotificationClient(): NotificationClient {
  return process.env.NOTIFICATIONS_ENABLED === 'true'
    ? new RealNotificationClient()
    : new MockNotificationClient()
}

/**
 * Não-bloqueante por design, mesmo princípio de `generateAndSaveNarrative`
 * (Fase 4): falha ao notificar nunca deve impedir a transição de estado real
 * que motivou a notificação. Engole qualquer erro do client e tenta gravar
 * `status: 'failed'` em vez de propagar — se até esse insert falhar (ex.:
 * banco fora do ar), o erro morre aqui mesmo, notificação é best-effort de
 * ponta a ponta.
 */
export async function notify(
  db: Db,
  applicationId: string,
  template: NotificationTemplate,
): Promise<void> {
  const client = getNotificationClient()
  try {
    await client.send(db, applicationId, template)
  } catch (err) {
    console.error(
      `[notifications] falha ao notificar "${template}" pra proposta ${applicationId}:`,
      err,
    )
    try {
      await db.insert(notificationLog).values({
        applicationId,
        channel: 'email',
        template,
        status: 'failed',
      })
    } catch {
      // Best-effort de ponta a ponta — nem o registro da falha pode derrubar o chamador.
    }
  }
}
