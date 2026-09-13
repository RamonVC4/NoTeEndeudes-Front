/**
 * Puerto a TypeScript del motor del backend (app/domain/motor/*).
 *
 * EXISTE SOLO PARA VITE_MOCK=1. En modo normal nada de este archivo corre:
 * los números los calcula el backend y el frontend nunca recalcula nada.
 *
 * Los umbrales están copiados sin cambiar un valor. Se verificó que reproduce
 * exactamente la respuesta real de GET /score del seed demo:
 * score 80, componentes {63, 75, 92, 100}, mínimo $9,253.46 el día 14.
 */
import type {
  Componente, DeudaRanking, Escenario, Estado, MetricasCompra, Modalidad,
  ScoreResponse, SimulacionResponse, TarjetaEstado, Veredicto,
} from './tipos'
import type { Flujo30d } from './ui-tipos'

// ------------------------------------------------------------- umbrales
const PESOS: Record<Componente, number> = {
  liquidez: 0.3, deuda: 0.3, utilizacion: 0.2, flujo: 0.2,
}
const LIQ_MES_1 = 1.0
const LIQ_MES_MAX = 3.0
const DEUDA_OPTIMA = 0.25
const DEUDA_CRITICA = 0.55
const UTIL_OPTIMA = 0.3
const UTIL_CRITICA = 0.8
const FLUJO_OBJETIVO = 0.5
const DIAS_PROYECCION = 30

const BANDAS: [number, string, ScoreResponse['color']][] = [
  [80, 'Saludable', 'verde'],
  [60, 'Estable', 'amarillo'],
  [40, 'En riesgo', 'naranja'],
  [0, 'Critico', 'rojo'],
]

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))

/**
 * round() de Python: mitad al par, no mitad hacia arriba. Sin esto,
 * $722.50 de intereses se redacta como "$723" y el mock deja de coincidir
 * con el texto que manda el backend.
 */
function redondear(n: number, dec = 0): number {
  const f = 10 ** dec
  const escalado = n * f
  const piso = Math.floor(escalado)
  // Empate exacto: solo ocurre cuando el .5 es representable en binario
  // (722.5, por ejemplo). Ahí, y solo ahí, se rompe hacia el par.
  if (escalado - piso === 0.5) return (piso % 2 === 0 ? piso : piso + 1) / f
  // toFixed redondea sobre el valor binario exacto, igual que Python.
  return Number(n.toFixed(dec))
}

const r2 = (n: number) => redondear(n, 2)

// ------------------------------------------------------------ agregados
export function obligacionesMensuales(e: Estado): number {
  let total = 0
  for (const t of e.tarjetas) {
    total += t.pago_minimo
    for (const m of t.msi ?? []) if (m.meses_restantes > 0) total += m.monto_mensual
  }
  return total
}

/** Los MSI en México son a 0%: no generan intereses. Solo el revolvente. */
export function interesesMensuales(e: Estado): number {
  let total = 0
  for (const t of e.tarjetas) {
    const msiPendiente = (t.msi ?? [])
      .filter(m => m.meses_restantes > 0)
      .reduce((s, m) => s + m.monto_mensual * m.meses_restantes, 0)
    total += Math.max(0, t.saldo - msiPendiente) * (t.tasa / 12)
  }
  return total
}

export const gastoMensualTotal = (e: Estado): number =>
  e.gastos.fijos + e.gastos.variables_prom + obligacionesMensuales(e)

const saldoCreditoTotal = (e: Estado) => e.tarjetas.reduce((s, t) => s + t.saldo, 0)
const limiteCreditoTotal = (e: Estado) => e.tarjetas.reduce((s, t) => s + t.limite, 0)

// ----------------------------------------------------------- componentes
function scoreLiquidez(disponible: number, gasto: number): number {
  if (gasto <= 0) return 100
  const meses = disponible / gasto
  if (meses <= LIQ_MES_1) return clamp((meses / LIQ_MES_1) * 50)
  return clamp(50 + ((meses - LIQ_MES_1) / (LIQ_MES_MAX - LIQ_MES_1)) * 50)
}

function scoreDeuda(obligaciones: number, ingreso: number): number {
  if (ingreso <= 0) return 0
  const ratio = obligaciones / ingreso
  return clamp(((DEUDA_CRITICA - ratio) / (DEUDA_CRITICA - DEUDA_OPTIMA)) * 100)
}

function scoreUtilizacion(saldo: number, limite: number): number {
  if (limite <= 0) return 100
  return clamp(((UTIL_CRITICA - saldo / limite) / (UTIL_CRITICA - UTIL_OPTIMA)) * 100)
}

function scoreFlujo(saldoMinimo: number, gasto: number): number {
  if (gasto <= 0) return 100
  return clamp((saldoMinimo / gasto / FLUJO_OBJETIVO) * 100)
}

// ----------------------------------------------------------- proyección
export function proyectarFlujo(e: Estado, dias = DIAS_PROYECCION): Flujo30d {
  let saldo = e.liquidez
  const gastoDiario = e.gastos.variables_prom / 30

  const eventos = new Map<number, number>()
  const agregar = (dia: number, monto: number) => {
    if (dia >= 1 && dia <= dias) eventos.set(dia, (eventos.get(dia) ?? 0) + monto)
  }

  for (const i of e.ingresos_programados) agregar(i.dia, i.monto)
  for (const c of e.compromisos) agregar(c.dia, -c.monto)
  for (const t of e.tarjetas) {
    const pago = t.pago_minimo + (t.msi ?? [])
      .filter(m => m.meses_restantes > 0)
      .reduce((s, m) => s + m.monto_mensual, 0)
    agregar(t.limite_pago, -pago)
  }

  const serie: number[] = []
  let minimo = saldo
  let diaMinimo = 0
  for (let d = 1; d <= dias; d++) {
    saldo += (eventos.get(d) ?? 0) - gastoDiario
    serie.push(r2(saldo))
    if (saldo < minimo) { minimo = saldo; diaMinimo = d }
  }
  return { serie, minimo: r2(minimo), dia_minimo: diaMinimo }
}

// --------------------------------------------------------------- score
export function calcularScore(e: Estado): ScoreResponse {
  const gasto = gastoMensualTotal(e)
  const flujo = proyectarFlujo(e)
  const obligaciones = obligacionesMensuales(e)
  const intereses = interesesMensuales(e)

  const comp: Record<Componente, number> = {
    liquidez: scoreLiquidez(e.liquidez, gasto),
    // Los intereses entran aquí a propósito: sin ellos, pagar deuda cara
    // bajaba el score.
    deuda: scoreDeuda(obligaciones + intereses, e.ingreso.mensual),
    utilizacion: scoreUtilizacion(saldoCreditoTotal(e), limiteCreditoTotal(e)),
    flujo: scoreFlujo(flujo.minimo, gasto),
  }

  const total = (Object.keys(PESOS) as Componente[])
    .reduce((s, k) => s + comp[k] * PESOS[k], 0)
  const puntaje = redondear(total)
  const [, nombreBanda, color] = BANDAS.find(([min]) => puntaje >= min)!

  return {
    score: puntaje,
    score_exacto: redondear(total, 1),
    banda: nombreBanda,
    color,
    componentes: {
      liquidez: redondear(comp.liquidez),
      deuda: redondear(comp.deuda),
      utilizacion: redondear(comp.utilizacion),
      flujo: redondear(comp.flujo),
    },
    pesos: { liquidez: 30, deuda: 30, utilizacion: 20, flujo: 20 },
    gasto_mensual_total: r2(gasto),
    obligaciones_mensuales: r2(obligaciones),
    intereses_mensuales: r2(intereses),
    flujo_30d: flujo,
  }
}

// ------------------------------------------------------------- evaluar
export type Accion =
  | { tipo: 'compra'; monto: number; modalidad: Modalidad; tarjeta_id?: string | null }
  | { tipo: 'pago'; monto: number; tarjeta_id: string }
  | { tipo: 'gasto'; monto: number; medio: 'debito' | 'credito'; tarjeta_id?: string | null }
  | { tipo: 'recurrente'; monto: number; dia: number; concepto: string }

const clonar = (e: Estado): Estado => JSON.parse(JSON.stringify(e))

function buscarTarjeta(e: Estado, id: string | null | undefined): TarjetaEstado {
  const t = e.tarjetas.find(x => x.id === id)
  if (!t) throw new Error(`Tarjeta no encontrada: ${id}`)
  return t
}

/** Nunca muta el estado que recibe: por eso el simulador es de solo lectura. */
export function evaluar(e: Estado, accion: Accion) {
  const nuevo = clonar(e)

  if (accion.tipo === 'compra') {
    if (accion.modalidad === 'contado') {
      nuevo.liquidez -= accion.monto
    } else {
      const t = buscarTarjeta(nuevo, accion.tarjeta_id)
      t.saldo += accion.monto
      if (accion.modalidad === 'credito') {
        // Revolver no es gratis: salir en 12 meses cuesta capital + intereses.
        const tm = t.tasa / 12
        t.pago_minimo += accion.monto * (tm / (1 - (1 + tm) ** -12))
      } else {
        const meses = parseInt(accion.modalidad.split('_')[0], 10)
        t.msi = [...(t.msi ?? []), {
          monto_mensual: accion.monto / meses,
          meses_restantes: meses,
          descripcion: null,
        }]
      }
    }
  } else if (accion.tipo === 'pago') {
    const t = buscarTarjeta(nuevo, accion.tarjeta_id)
    nuevo.liquidez -= accion.monto
    t.saldo = Math.max(0, t.saldo - accion.monto)
  } else if (accion.tipo === 'gasto') {
    if (accion.medio === 'credito') {
      buscarTarjeta(nuevo, accion.tarjeta_id).saldo += accion.monto
    } else {
      nuevo.liquidez -= accion.monto
    }
  } else {
    // Un recurrente no cobra nada hoy: describe un compromiso que se repite.
    nuevo.gastos.fijos += accion.monto
    nuevo.compromisos.push({
      dia: accion.dia, monto: accion.monto, concepto: accion.concepto,
    })
  }

  const antes = calcularScore(e)
  const despues = calcularScore(nuevo)
  return { estado: nuevo, antes, despues }
}

// ------------------------------------------------------------ simulador
/** Meses que amortiza el motor para ponerle precio al revolvente. */
const MESES_REVOLVENTE = 12

/** El escenario más su score exacto, que se usa para ordenar y no viaja. */
type ConExacto = Escenario & { _exacto: number }

/**
 * DESEMPATE, no criterio principal: solo se consulta cuando dos formas de pagar
 * dejan el mismo score. Entonces el revolvente siempre pierde (es el único que
 * cobra intereses), en compras chicas gana el contado y en grandes los MSI, que
 * a igualdad de score protegen el efectivo.
 */
function preferenciaModalidad(
  mod: Modalidad | null,
  monto: number,
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

    // REGLA DE ABUNDANCIA
    if (monto <= (liquidez * 0.25) || monto < 500 || score >= 95) return 0

    return 2
  }

<<<<<<< HEAD
=======
  // MSI: a igualdad de score protegen el efectivo.
  return 1
}
>>>>>>> 80e6e49d9639a2960d8a9f0351b9383bb82cafc1

function escenariosDeTarjeta(
  e: Estado, t: TarjetaEstado, monto: number, plazos: number[],
): ConExacto[] {
  const disponible = t.limite - t.saldo
  if (disponible < monto) {
    return [{
      modalidad: null, tarjeta: t.nombre, tarjeta_id: t.id,
      disponible, holgura_despues: null, pago_mensual: 0,
      viable: false,
      motivo: `Disponible $${miles(disponible)}, no alcanza`,
      score_despues: null, delta: null,
      costo_total: null, mejor_de_tarjeta: false, _exacto: -1,
    }]
  }

  const filas: ConExacto[] = []

  // El mínimo para meses lo pone EL BANCO. Antes los plazos se descartaban en
  // silencio; ahora el usuario los eligió a propósito para ESTA tarjeta.
  const minimo = t.monto_minimo_msi ?? 0
  if (plazos.length > 0 && monto < minimo) {
    filas.push({
      modalidad: null, tarjeta: t.nombre, tarjeta_id: t.id,
      disponible, holgura_despues: null, pago_mensual: 0,
      viable: false,
      motivo: `Los meses con esta tarjeta piden minimo $${miles(minimo)}`,
      score_despues: null, delta: null,
      costo_total: null, mejor_de_tarjeta: false, _exacto: -1,
    })
    plazos = []
  }

  const modalidades: Modalidad[] = [
    'credito', ...plazos.map(m => `${m}_msi` as Modalidad),
  ]
  for (const mod of modalidades) {
    const r = evaluar(e, { tipo: 'compra', monto, tarjeta_id: t.id, modalidad: mod })
    let pago: number
    if (mod === 'credito') {
      const tm = t.tasa / 12
      pago = monto * (tm / (1 - (1 + tm) ** -MESES_REVOLVENTE))
    } else {
      pago = monto / parseInt(mod.split('_')[0], 10)
    }
    filas.push({
      modalidad: mod, tarjeta: t.nombre, tarjeta_id: t.id,
      disponible, pago_mensual: r2(pago),
      viable: true, motivo: null,
      holgura_despues: r2(disponible - monto),
      score_despues: r.despues.score,
      delta: r.despues.score - r.antes.score,
      costo_total: mod === 'credito' ? r2(pago * MESES_REVOLVENTE) : r2(monto),
      mejor_de_tarjeta: false,
      _exacto: r.despues.score_exacto,
    })
  }
  return filas
}

export interface OpcionMock { tarjeta_id: string; plazos?: number[] }

export function simularCompra(
  e: Estado, monto: number, plazos: number[] = [],
  opciones: OpcionMock[] | null = null, incluirContado = true,
): SimulacionResponse {
  const conExacto: ConExacto[] = []

  // Con `opciones`, la petición define además QUÉ tarjetas entran: las que el
  // usuario no puso sobre la mesa no se evalúan porque en esa tienda no las
  // va a usar.
  const porId = new Map(e.tarjetas.map(t => [t.id, t]))
  const pares: [TarjetaEstado, number[]][] = opciones === null
    ? e.tarjetas.map(t => [t, plazos])
    : opciones.flatMap(o => {
        const t = porId.get(o.tarjeta_id)
        return t ? [[t, o.plazos ?? []] as [TarjetaEstado, number[]]] : []
      })
  if (opciones === null) incluirContado = true

  if (incluirContado) {
    const contado = evaluar(e, { tipo: 'compra', monto, modalidad: 'contado' })
    const alcanza = e.liquidez >= monto
    conExacto.push({
      modalidad: 'contado', tarjeta: null, tarjeta_id: null,
      disponible: e.liquidez,
      holgura_despues: r2(e.liquidez - monto),
      pago_mensual: 0,
      viable: alcanza,
      motivo: alcanza ? null : 'Liquidez insuficiente',
      score_despues: contado.despues.score,
      delta: contado.despues.score - contado.antes.score,
      costo_total: r2(monto),
      mejor_de_tarjeta: false,
      _exacto: contado.despues.score_exacto,
    })
  }

  for (const [t, plazosTarjeta] of pares) {
    conExacto.push(...escenariosDeTarjeta(e, t, monto, plazosTarjeta))
  }

  // Viables primero y MEJOR SCORE arriba — el criterio, no un desempate. Por el
  // score exacto y no el redondeado: dos opciones que muestran "61" pueden no
  // valer lo mismo. Después la preferencia, el costo y la holgura.
  const scoreActual = calcularScore(e).score
  const diasParaNomina = Math.min(DIAS_PROYECCION, ...e.ingresos_programados.map(i => i.dia))
  const preferencia = (s: Escenario) =>
    preferenciaModalidad(s.modalidad, monto, e.liquidez, scoreActual, diasParaNomina)
  conExacto.sort((a, b) =>
    Number(!a.viable) - Number(!b.viable) ||
    b._exacto - a._exacto ||
    preferencia(a) - preferencia(b) ||
    (a.costo_total ?? Infinity) - (b.costo_total ?? Infinity) ||
    (b.holgura_despues ?? 0) - (a.holgura_despues ?? 0))

  // El mejor de cada tarjeta queda marcado: es lo que viaja al análisis.
  const vistos = new Set<string | null>()
  for (const s of conExacto) {
    if (s.viable && !vistos.has(s.tarjeta_id)) {
      vistos.add(s.tarjeta_id)
      s.mejor_de_tarjeta = true
    }
  }

  const escenarios: Escenario[] = conExacto.map(({ _exacto, ...resto }) => resto)
  // El primero de los VIABLES, no el primero de la lista.
  const recomendado = escenarios.find(s => s.viable) ?? null
  const juicio = evaluarCompra(e, monto, recomendado)

  return {
    monto,
    plazos_ofrecidos: opciones === null
      ? plazos
      : [...new Set(opciones.flatMap(o => o.plazos ?? []))].sort((a, b) => a - b),
    score_actual: scoreActual,
    recomendado,
    escenarios,
    veredicto: juicio.veredicto,
    razones_veredicto: juicio.razones,
    metricas: juicio.metricas,
  }
}

// ------------------------------------------------------------- veredicto
// Lo emite el MOTOR, no la IA. Es lo que permite advertir "esto te deja sin
// colchón" aunque Gemini esté caído.
const COLCHON_CRITICO = 0.5
const CAIDA_GRAVE = 15
const CAIDA_NOTABLE = 5
const PESO_INGRESO_ALTO = 50

const ratio = (a: number, b: number) => (b > 0 ? a / b : 0)

const cargaDeDeuda = (e: Estado) =>
  ratio(obligacionesMensuales(e) + interesesMensuales(e), e.ingreso.mensual)

export function evaluarCompra(
  e: Estado, monto: number, recomendado: Escenario | null,
): { veredicto: Veredicto; razones: string[]; metricas: MetricasCompra | null } {
  if (!recomendado) {
    return {
      veredicto: 'no_conviene',
      razones: ['ninguna forma de pago te alcanza hoy'],
      metricas: null,
    }
  }

  const r = evaluar(e, {
    tipo: 'compra', monto,
    modalidad: recomendado.modalidad as Modalidad,
    tarjeta_id: recomendado.tarjeta_id,
  })
  const d = r.estado

  const m: MetricasCompra = {
    monto_vs_liquidez_pct: redondear(ratio(monto, e.liquidez) * 100, 1),
    monto_vs_ingreso_mensual_pct: redondear(ratio(monto, e.ingreso.mensual) * 100, 1),
    colchon_meses_antes: redondear(ratio(e.liquidez, gastoMensualTotal(e)), 2),
    colchon_meses_despues: redondear(ratio(d.liquidez, gastoMensualTotal(d)), 2),
    utilizacion_antes: redondear(ratio(saldoCreditoTotal(e), limiteCreditoTotal(e)) * 100, 1),
    utilizacion_despues: redondear(ratio(saldoCreditoTotal(d), limiteCreditoTotal(d)) * 100, 1),
  }

  const caida = r.antes.score - r.despues.score
  // TODA regla de nivel exige además que la compra EMPEORE ese nivel. Sin eso,
  // comprar algo de $300 en efectivo avisaba "tu crédito subiría al 34% de uso"
  // — un 34% que ya estaba ahí y que el efectivo no toca.
  const bajaColchon = m.colchon_meses_despues < m.colchon_meses_antes
  const subeUso = m.utilizacion_despues > m.utilizacion_antes

  const graves: string[] = []
  const avisos: string[] = []

  if (bajaColchon && m.colchon_meses_despues < COLCHON_CRITICO) {
    graves.push(`te quedarias con ${m.colchon_meses_despues.toFixed(1)} meses de gastos cubiertos: menos de dos semanas de colchon`)
  } else if (bajaColchon && m.colchon_meses_despues < LIQ_MES_1) {
    avisos.push(`tu colchon baja a ${m.colchon_meses_despues.toFixed(1)} meses de gastos, por debajo del mes que se recomienda`)
  }

  if (subeUso && m.utilizacion_despues >= UTIL_CRITICA * 100) {
    graves.push(`tu credito quedaria usado al ${m.utilizacion_despues.toFixed(0)}%, que es donde mas castiga tu score`)
  } else if (subeUso && m.utilizacion_despues >= UTIL_OPTIMA * 100) {
    avisos.push(`tu credito subiria del ${m.utilizacion_antes.toFixed(0)}% al ${m.utilizacion_despues.toFixed(0)}% de uso`)
  }

  if (cargaDeDeuda(d) > cargaDeDeuda(e) && cargaDeDeuda(d) >= DEUDA_CRITICA) {
    graves.push(`tus pagos fijos se comerian el ${(cargaDeDeuda(d) * 100).toFixed(0)}% de tu ingreso`)
  }

  if (caida >= CAIDA_GRAVE) graves.push(`tu score caeria ${caida} puntos`)
  else if (caida >= CAIDA_NOTABLE) avisos.push(`tu score bajaria ${caida} puntos`)

  if (m.monto_vs_ingreso_mensual_pct >= PESO_INGRESO_ALTO) {
    avisos.push(`la compra vale el ${m.monto_vs_ingreso_mensual_pct.toFixed(0)}% de lo que ganas en un mes`)
  }

  if (graves.length > 0) return { veredicto: 'no_conviene', razones: [...graves, ...avisos], metricas: m }
  if (avisos.length > 0) return { veredicto: 'conviene_con_cuidado', razones: avisos, metricas: m }
  return { veredicto: 'conviene', razones: [], metricas: m }
}

// ----------------------------------------------------------- priorización
const PESO_TASA = 0.45, PESO_UTIL = 0.35, PESO_COSTO = 0.2
const TASA_REFERENCIA = 0.8, UTIL_REFERENCIA = 0.9, COSTO_REFERENCIA = 1500
const UMBRAL_TASA = 0.55, UMBRAL_UTIL = 0.7, UMBRAL_COSTO = 400

/** Igual que el f"${n:,.0f}" del backend: coma de miles, mitad al par. */
export const miles = (n: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(redondear(n))

export function priorizarDeudas(e: Estado): DeudaRanking[] {
  const ranking: DeudaRanking[] = []
  for (const t of e.tarjetas) {
    if (t.saldo <= 0) continue
    const util = t.limite ? t.saldo / t.limite : 0
    const costo = t.saldo * (t.tasa / 12)

    const prioridad =
      Math.min(t.tasa / TASA_REFERENCIA, 1) * 100 * PESO_TASA +
      Math.min(util / UTIL_REFERENCIA, 1) * 100 * PESO_UTIL +
      Math.min(costo / COSTO_REFERENCIA, 1) * 100 * PESO_COSTO

    // Redactadas aquí igual que en el motor: la IA explica, no calcula.
    const razones: string[] = []
    if (t.tasa >= UMBRAL_TASA) razones.push(`tasa alta (${(t.tasa * 100).toFixed(0)}% anual)`)
    if (util >= UMBRAL_UTIL) razones.push(`utilizacion al ${(util * 100).toFixed(0)}%, castiga tu score`)
    if (costo >= UMBRAL_COSTO) razones.push(`te cuesta $${miles(costo)} al mes solo en intereses`)

    ranking.push({
      // El ranking trae el id: cruzar por nombre se rompe en cuanto dos
      // tarjetas lo repiten.
      tarjeta_id: t.id,
      tarjeta: t.nombre,
      saldo: t.saldo,
      utilizacion: redondear(util * 100, 1),
      tasa: t.tasa,
      costo_intereses_mes: r2(costo),
      prioridad: redondear(prioridad, 1),
      razones,
    })
  }
  ranking.sort((a, b) => b.prioridad - a.prioridad)
  return ranking
}