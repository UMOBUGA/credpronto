import { checkVehicleRestrictionMock } from './vehicleRestriction'

describe('checkVehicleRestrictionMock', () => {
  const originalScenario = process.env.MOCK_VEHICLE_SCENARIO

  afterEach(() => {
    process.env.MOCK_VEHICLE_SCENARIO = originalScenario
  })

  it('é determinístico pra mesma placa', () => {
    delete process.env.MOCK_VEHICLE_SCENARIO
    expect(checkVehicleRestrictionMock('ABC1D23')).toEqual(checkVehicleRestrictionMock('ABC1D23'))
  })

  it('respeita o cenário forçado "restricted"', () => {
    process.env.MOCK_VEHICLE_SCENARIO = 'restricted'
    expect(checkVehicleRestrictionMock('QUALQUER1').restrictionFound).toBe(true)
  })

  it('respeita o cenário forçado "clean"', () => {
    process.env.MOCK_VEHICLE_SCENARIO = 'clean'
    expect(checkVehicleRestrictionMock('QUALQUER1').restrictionFound).toBe(false)
  })

  it('é insensível a caixa/espaço na placa', () => {
    delete process.env.MOCK_VEHICLE_SCENARIO
    expect(checkVehicleRestrictionMock('abc1d23')).toEqual(checkVehicleRestrictionMock(' ABC1D23 '))
  })
})
