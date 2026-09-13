// =====================================================================
// MOTOR MOCK DE SIMULACIÓN (TypeScript)
// =====================================================================

export type Modalidad = 'contado' | 'credito' | string // ej. '3_msi', '6_msi', etc.

export interface TarjetaMock {
  id: string
  nombre: string
  limite: number
  saldo: number
  tasa: number // tasa anual
  monto_minimo_msi?: number
  msiDisponibles: number[]
}

export interface EstadoFinancieroMock {
  liquidez: number
  ingreso: { mensual: number }
  gastos_fijos: number
  tarjetas: TarjetaMock[]
  ingresos_programados: { dia: number; monto: number }[]
}

const MESES_REVOLVENTE = 12
const DIAS_PROYECCION = 30

// --- Funciones de Utilidad ---
function r2(val: number): number {
  return Math.round(val * 100) / 100
}

function clamp(val: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, val))
}

function gastoMensualTotal(estado: EstadoFinancieroMock): number {
  return estado.gastos_fijos
}

function interesesMensuales(estado: EstadoFinancieroMock): number {
  let intereses = 0
  for (const t of estado.tarjetas) {
    const tasaMensual = t.tasa / 12
    intereses += t.saldo * tasaMensual
  }
  return intereses
}

function obligacionesMensuales(estado: EstadoFinancieroMock): number {
  let total = 0
  for (const t of estado.tarjetas) {
    // Estimación de pago mínimo o revolvente
    total += t.saldo * 0.05
  }
  return total
}

function saldoCreditoTotal(estado: EstadoFinancieroMock): number {
  return estado.tarjetas.reduce((acc, t) => acc + t.saldo, 0)
}

function limiteCreditoTotal(estado: EstadoFinancieroMock): number {
  return estado.tarjetas.reduce((acc, t) => acc + t.limite, 0)
}

// --- Proyección de Flujo Simplificada ---
function proyectarFlujo(estado: EstadoFinancieroMock) {
  let minSaldo = estado.liquidez
  let diaMin = 1
  let saldoActual = estado.liquidez
  const gastoDiario = estado.gastos_fijos / 30

  for (let dia = 1; dia <= DIAS_PROYECCION; dia++) {
    // Sumar ingresos programados si coinciden
    for (const ing of estado.ingresos_programados) {
      if (ing.dia === dia) {
        saldoActual += ing.monto
      }
    }
    saldoActual -= gastoDiario
    if (saldoActual < minSaldo) {
      minSaldo = saldoActual
      diaMin = dia
    }
  }
  return { minSaldo, diaMin }
}

// --- Cálculo del Score ---
function calcularScore(estado: EstadoFinancieroMock) {
  const gastoTotal = gastoMensualTotal(estado)
  const { minSaldo } = proyectarFlujo(estado)
  const obligaciones = obligacionesMensuales(estado)
  const intereses = interesesMensuales(estado)

  // Componentes ponderados
  const disponible = estado.liquidez
  const mesesLiq = gastoTotal > 0 ? disponible / gastoTotal : 3
  const scoreLiq = clamp(mesesLiq <= 1 ? (mesesLiq / 1) * 50 : 50 + ((mesesLiq - 1) / 5) * 50)

  const ingresoMensual = estado.ingreso.mensual
  const ratioDeuda = ingresoMensual > 0 ? (obligaciones + intereses * 2.0) / ingresoMensual : 0
  const scoreDeud = clamp((0.5 - ratioDeuda) / (0.5 - 0.1) * 100)

  const limiteTotal = limiteCreditoTotal(estado)
  const saldoTotal = saldoCreditoTotal(estado)
  const ratioUtil = limiteTotal > 0 ? saldoTotal / limiteTotal : 0
  const scoreUtil = clamp((0.8 - ratioUtil) / (0.8 - 0.3) * 100)

  const ratioFlujo = gastoTotal > 0 ? minSaldo / gastoTotal : 1
  const scoreFlu = clamp((ratioFlujo / 0.5) * 100)

  const total = scoreLiq * 0.3 + scoreDeud * 0.3 + scoreUtil * 0.2 + scoreFlu * 0.2

  return {
    score: Math.round(total),
    score_exacto: r2(total),
  }
}

// --- Evaluación de un escenario aislado ---
function evaluar(estado: EstadoFinancieroMock, accion: { tipo: string; monto: number; tarjeta_id?: string; modalidad?: string }) {
  const scoreAntes = calcularScore(estado)
  
  // Clonar estado para simular el impacto
  const nuevoEstado = JSON.parse(JSON.stringify(estado))
  if (accion.modalidad === 'contado') {
    nuevoEstado.liquidez -= accion.monto
  } else if (accion.tarjeta_id) {
    const tarjeta = nuevoEstado.tarjetas.find((t: TarjetaMock) => t.id === accion.tarjeta_id)
    if (tarjeta) {
      tarjeta.saldo += accion.monto
    }
  }

  const scoreDespues = calcularScore(nuevoEstado)

  return {
    antes: scoreAntes,
    despues: scoreDespues,
    delta: scoreDespues.score - scoreAntes.score,
  }
}

// --- Regla de Preferencia de Modalidad ---
function preferenciaModalidad(
  mod: Modalidad | null,
  monto: number,
  pagoMensual: number,
  liquidez: number,
  score: number,
  diasParaNomina: number
): number {
  if (!mod) return 5
  if (mod === 'credito') return 4

  if (mod === 'contado') {
    const colchonMinimoVital = diasParaNomina * 400
    const liquidezRestante = liquidez - monto

    if (liquidezRestante < colchonMinimoVital) return 3
    if (monto > 2000) return 3 // Penalizar contado para compras grandes, favoreciendo MSI
    if (monto <= (liquidez * 0.25) || monto < 500 || score >= 95) return 0
    return 2
  }

  if (mod.includes('_msi')) {
    const plazo = parseInt(mod.split('_')[0], 10)
    if (pagoMensual < 500 && plazo >= 9) return 3

    if (monto >= 15000) {
      if (plazo >= 12) return 1
      return 2
    } else if (monto >= 5000) {
      if (plazo >= 6 && plazo <= 9) return 1
      return 2
    } else {
      if (plazo <= 6) return 1
      return 2
    }
  }

  return 5
}

// --- Generación de Escenarios por Tarjeta ---
function escenariosDeTarjeta(estado: EstadoFinancieroMock, t: TarjetaMock, monto: number, plazos: number[]) {
  const disponible = t.limite - t.saldo
  if (disponible < monto) {
    return [{
      modalidad: null, tarjeta: t.nombre, tarjeta_id: t.id,
      disponible, holgura_despues: null, pago_mensual: 0,
      viable: false, motivo: `Disponible $${disponible.toLocaleString()}, no alcanza`,
      score_despues: null, delta: null, costo_total: null, mejor_de_tarjeta: false, _exacto: -1.0
    }]
  }

  const filas = []
  const modalidades = ['credito', ...plazos.map(m => `${m}_msi`)]

  for (const mod of modalidades) {
    const r = evaluar(estado, { tipo: 'compra', monto, tarjeta_id: t.id, modalidad: mod })
    let pago = 0
    if (mod === 'credito') {
      const tm = t.tasa / 12
      pago = monto * (tm / (1 - (1 + tm) ** -MESES_REVOLVENTE))
    } else {
      pago = monto / parseInt(mod.split('_')[0], 10)
    }

    let scoreDesp = r.despues.score
    let exactoDesp = r.despues.score_exacto
    let deltaVal = r.delta

    // CASTIGO DE SENTIDO COMÚN: El crédito con intereses caros nunca debe mostrar un score inflado
    if (mod === 'credito') {
      scoreDesp = Math.max(0, scoreDesp - 6)
      exactoDesp = Math.max(0, exactoDesp - 6.0)
      deltaVal = deltaVal - 6
    }

    filas.push({
      modalidad: mod,
      tarjeta: t.nombre,
      tarjeta_id: t.id,
      disponible,
      pago_mensual: r2(pago),
      viable: true,
      motivo: null,
      holgura_despues: r2(disponible - monto),
      score_despues: scoreDesp,
      delta: deltaVal,
      costo_total: mod === 'credito' ? r2(pago * MESES_REVOLVENTE) : r2(monto),
      mejor_de_tarjeta: false,
      _exacto: exactoDesp,
    })
  }

  return filas
}

// --- Simulación Global de Compra ---
export function simularCompra(estado: EstadoFinancieroMock, monto: number, tarjetaPlazosMap: Record<string, number[]>) {
  const escenarios: any[] = []

  // 1. Escenario de Contado
  const rContado = evaluar(estado, { tipo: 'compra', monto, modalidad: 'contado' })
  const diasParaNomina = 15 // Mock genérico
  const viableContado = estado.liquidez >= monto

  escenarios.push({
    modalidad: 'contado',
    tarjeta: 'Con tu dinero',
    tarjeta_id: null,
    disponible: estado.liquidez,
    pago_mensual: monto,
    viable: viableContado,
    motivo: viableContado ? null : 'Efectivo insuficiente',
    holgura_despues: r2(estado.liquidez - monto),
    score_despues: viableContado ? rContado.despues.score : null,
    delta: viableContado ? rContado.delta : null,
    costo_total: monto,
    _exacto: viableContado ? rContado.despues.score_exacto : -1.0,
  })

  // 2. Escenarios por Tarjeta
  for (const t of estado.tarjetas) {
    const plazos = tarjetaPlazosMap[t.id] || []
    const fil = escenariosDeTarjeta(estado, t, monto, plazos)
    escenarios.push(...fil)
  }

  // Orden estratégico con castigo al revolvente y jerarquía limpia
  escenarios.sort((a, b) => {
    if (!a.viable && b.viable) return 1
    if (a.viable && !b.viable) return -1

    const esCreditoA = a.modalidad === 'credito' ? 1 : 0
    const esCreditoB = b.modalidad === 'credito' ? 1 : 0
    if (esCreditoA !== esCreditoB) return esCreditoA - esCreditoB

    const costoA = a.costo_total ?? Infinity
    const costoB = b.costo_total ?? Infinity
    if (costoA !== costoB) return costoA - costoB

    const scoreA = a.score_despues ?? 0
    const scoreB = b.score_despues ?? 0
    const prefA = preferenciaModalidad(a.modalidad, monto, a.pago_mensual, estado.liquidez, scoreA, diasParaNomina)
    const prefB = preferenciaModalidad(b.modalidad, monto, b.pago_mensual, estado.liquidez, scoreB, diasParaNomina)
    if (prefA !== prefB) return prefA - prefB

    if (scoreB !== scoreA) return scoreB - scoreA
    if (b._exacto !== a._exacto) return b._exacto - a._exacto

    return (b.holgura_despues ?? 0) - (a.holgura_despues ?? 0)
  })

  return escenarios
}
