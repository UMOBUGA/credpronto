import { createHash } from 'node:crypto'

export interface VehicleRestrictionResult {
  restrictionFound: boolean
  restrictionDetails: { reason: string }[] | null
}

/**
 * Não existe API pública gratuita de consulta de roubo/furto/gravame por
 * placa no Brasil — só o app/site oficial do Sinesp (sem API pra terceiros)
 * e provedores comerciais (Infosimples, API Full, ConsultarPlaca) que
 * cobram por consulta e exigem contrato, mesma limitação do bureau (ver
 * `bureau.ts`). Mock determinístico por placa: a mesma placa sempre produz
 * o mesmo resultado, útil pra demo e teste.
 */
export function checkVehicleRestrictionMock(plate: string): VehicleRestrictionResult {
  const forced = process.env.MOCK_VEHICLE_SCENARIO
  if (forced === 'restricted') {
    return {
      restrictionFound: true,
      restrictionDetails: [{ reason: 'Restrição simulada de furto/roubo/gravame' }],
    }
  }
  if (forced === 'clean') {
    return { restrictionFound: false, restrictionDetails: null }
  }

  const digest = createHash('sha256').update(plate.trim().toUpperCase()).digest()
  const restrictionFound = digest[0]! % 12 === 0

  return {
    restrictionFound,
    restrictionDetails: restrictionFound
      ? [{ reason: 'Restrição simulada de furto/roubo/gravame' }]
      : null,
  }
}
