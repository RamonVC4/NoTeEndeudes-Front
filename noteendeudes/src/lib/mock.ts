/**
 * MODO MOCK — el seguro de vida de la demo.
 *
 * Con VITE_MOCK=1 la app entera corre sin tocar la red. Los datos base son
 * capturas del servidor (seed demo) y los números los produce motor-mock.ts,
 * que reproduce el motor del backend exactamente.
 *
 * Existe por una sola razón: si el wifi del hackathon o el backend se caen a
 * media presentación, la demo sigue corriendo.
 *
 * El estado vive en memoria: recargar la página vuelve al seed limpio.
 *
 * Simula el contrato /api/v1 completo, incluidos los caminos que en el servidor
 * real cuesta provocar y hay que poder ensayar: la idempotencia (200 con
 * `repetido: true`) y el 409 por versión desactualizada.
 */
import datos from './mock-datos.json'
import { ApiException } from './api'
import {
  calcularScore, evaluar, interesesMensuales, miles, priorizarDeudas, simularCompra,
} from './motor-mock'
import { PLAZOS_COMUNES } from './tipos'
import type {
  AnalisisCompraResponse, CategoriaResumen, Coleccion, ConfirmacionCreate,
  DeudaRanking, Estado, ExplicacionDeudaResponse, ExtraccionResponse, Frecuencia,
  IngresoCreate, IngresoResumen, MedioPago, MovimientoCreate, MovimientoResponse,
  MovimientoResumen, MSICreate, MSIResumen, OnboardingRequest, PagoRequest,
  PagoPendiente, PendientesResponse, PeriodoCreate, PeriodoResumen,
  RecurrenteCreate, RecurrenteResumen, SimulacionRequest, SimulacionResponse,
  TarjetaCreate, TarjetaEstado, TarjetaResumen, TarjetaUpdate, TipoMovimiento,
  UsuarioResumen,
} from './tipos'
import { nombreModalidad } from './formato'
import { FACTOR_MENSUAL, familiaFrecuencia } from './ui-tipos'

const LATENCIA = 400
const espera = (ms: number) => new Promise(r => setTimeout(r, ms))

// ------------------------------------------------------------ estado vivo
interface Base {
  liquidez: number
  ingreso: { mensual: number }
  ingresos_programados: Estado['ingresos_programados']
  gastos: { fijos: number; variables_prom: number }
  compromisos: Estado['compromisos']
}

interface EstadoMock {
  usuario: UsuarioResumen
  categorias: CategoriaResumen[]
  base: Base
  tarjetas: TarjetaResumen[]
  ingresos: IngresoResumen[]
  recurrentes: RecurrenteResumen[]
  movimientos: MovimientoResumen[]
  /** El seed no trae cortes: se abren desde la pantalla. */
  periodos?: PeriodoResumen[]
}

const clonar = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

let s: EstadoMock = clonar(datos as unknown as EstadoMock)
let siguienteId = 900

const periodosDe = (tarjetaId: string) =>
  (s.periodos ?? []).filter(p => p.tarjeta_id === tarjetaId)

/**
 * Las claves de idempotencia ya usadas, con la respuesta que dieron.
 *
 * Es lo que permite ensayar sin backend el camino que más fácil se implementa
 * mal en el cliente: reintentar con la misma clave devuelve lo que ya existía
 * y NO vuelve a mover el saldo.
 */
const yaUsadas = new Map<string, unknown>()

/** El estado que consume el motor: solo crédito con términos completos. */
function estadoMotor(): Estado {
  const tarjetas: TarjetaEstado[] = s.tarjetas
    .filter(t => t.activa && t.tipo === 'credito' && !t.requiere_terminos && t.limite !== null)
    .map(t => ({
      id: t.id,
      nombre: t.nombre,
      limite: t.limite!,
      saldo: t.saldo ?? 0,
      tasa: t.tasa_anual ?? 0,
      pago_minimo: t.pago_minimo ?? 0,
      corte: t.dia_corte ?? 1,
      limite_pago: t.dia_limite_pago ?? 1,
      monto_minimo_msi: t.monto_minimo_msi ?? 0,
      msi: (t.msi ?? []).map(m => ({
        monto_mensual: m.monto_mensual,
        meses_restantes: m.meses_restantes,
        descripcion: m.descripcion,
      })),
      disponible: t.limite! - (t.saldo ?? 0),
    }))
  return { ...clonar(s.base), tarjetas }
}

const buscarTarjeta = (id: string | null | undefined) =>
  s.tarjetas.find(t => t.id === id && t.activa)

/** disponible es derivado: se recalcula al vuelo, nunca se guarda. */
function conDisponible(t: TarjetaResumen): TarjetaResumen {
  if (t.limite === null || t.saldo === null) return t
  return { ...t, disponible: r2(t.limite - t.saldo) }
}

/** Toda colección va con sobre. `total` es null donde el backend no cuenta. */
function sobre<T>(data: T[], total: number | null = data.length): Coleccion<T> {
  return { data, meta: { hay_mas: false, siguiente_cursor: null, total } }
}

const r2 = (n: number) => Math.round(n * 100) / 100

const nombreCategoria = (clave: string | null | undefined) =>
  s.categorias.find(c => c.clave === clave)?.nombre ?? null

// --------------------------------------------------------------- errores
const reglaDeNegocio = (mensaje: string, detalle: Record<string, unknown> = {}) =>
  new ApiException(422, 'regla_de_negocio', mensaje, detalle)
const validacion = (campo: string, error: string) =>
  new ApiException(422, 'validacion', 'Los datos enviados no son validos',
    { campos: [{ campo, error }] })
const conflicto = (mensaje: string, detalle: Record<string, unknown> = {}) =>
  new ApiException(409, 'conflicto', mensaje, detalle)
const noEncontrado = (mensaje: string) => new ApiException(404, 'no_encontrado', mensaje)

// ------------------------------------------------------------ validación
const hoy = () => new Date(new Date().toDateString())

function isoHoy(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function validarFecha(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 'La fecha debe tener formato YYYY-MM-DD'
  const [a, m, d] = iso.split('-').map(Number)
  const f = new Date(a, m - 1, d)
  const dias = (hoy().getTime() - f.getTime()) / 86400000
  if (dias > 365) return 'La fecha es demasiado antigua'
  if (dias < -1) return 'La fecha no puede estar en el futuro'
  return null
}

function validarCategoria(clave: string | null | undefined) {
  if (!clave) return
  if (!s.categorias.some(c => c.clave === clave)) {
    throw new ApiException(
      422, 'validacion', `La categoria "${clave}" no existe`,
      { validas: s.categorias.map(c => c.clave) },
    )
  }
}

/**
 * Las dos familias de frecuencia, con la regla que el esquema impone:
 * semanal y catorcenal se anclan a una fecha y PROHIBEN `dia_pago_2`.
 */
function validarIngreso(i: IngresoCreate): string | null {
  const familia = familiaFrecuencia(i.frecuencia)
  if (familia === 'ancla') {
    if (!i.fecha_ancla) {
      return `Un ingreso ${i.frecuencia} se define por su fecha de referencia: indica cuando fue un pago real`
    }
    if (i.dia_pago_2 != null) {
      return `Un ingreso ${i.frecuencia} no lleva segundo dia de pago: su ciclo se cuenta en dias, no en dias del mes`
    }
    return null
  }
  if (i.dia_pago == null) return `Un ingreso ${i.frecuencia} necesita su dia de pago`
  if (familia === 'un_dia' && i.dia_pago_2 != null) {
    return 'Un ingreso mensual solo tiene un dia de pago'
  }
  if (familia === 'dos_dias') {
    if (i.dia_pago_2 == null) return 'Un ingreso quincenal necesita sus dos dias de pago'
    if (i.dia_pago === i.dia_pago_2) return 'Los dos dias de pago no pueden ser el mismo'
  }
  return null
}

interface TerminosLike {
  limite: number; saldo: number; dia_corte: number; dia_limite_pago: number
}
function validarTerminos(t: TerminosLike): string | null {
  if (t.dia_corte === t.dia_limite_pago)
    return 'El dia de corte y el dia limite de pago no pueden ser el mismo'
  if (t.saldo > t.limite) return 'El saldo no puede exceder el limite'
  return null
}

/**
 * Las combinaciones válidas de `tipo` × `medio` × `tarjeta_id`. Cualquier otra
 * es 422 en el servidor real, y aquí también: si el mock fuera más permisivo,
 * un formulario roto pasaría la demo y fallaría contra el backend.
 */
function validarCombinacion(m: MovimientoCreate): string | null {
  const conTarjeta = m.tarjeta_id != null && m.tarjeta_id !== ''
  if (m.tipo === 'gasto' && m.medio === 'credito') {
    return conTarjeta ? null : 'Un gasto a credito necesita una tarjeta'
  }
  if (m.tipo === 'pago') {
    if (m.medio === 'credito') return 'Una tarjeta no se paga con ella misma'
    return conTarjeta ? null : 'Un pago necesita la tarjeta que estas pagando'
  }
  if (m.medio === 'credito') return `Un ${m.tipo} no puede ser a credito`
  return conTarjeta ? `Un ${m.tipo} en ${m.medio} no lleva tarjeta` : null
}

// -------------------------------------------------------------- ingresos
function agregarIngreso(i: IngresoCreate): IngresoResumen {
  const nuevo: IngresoResumen = {
    id: String(siguienteId++),
    concepto: i.concepto,
    monto: i.monto,
    frecuencia: i.frecuencia,
    dia_pago: i.dia_pago ?? null,
    dia_pago_2: i.dia_pago_2 ?? null,
    fecha_ancla: i.fecha_ancla ?? null,
    ajuste_mes_corto: i.ajuste_mes_corto ?? 'ultimo_dia',
    activo: true,
    monto_mensual: r2(i.monto * FACTOR_MENSUAL[i.frecuencia as Frecuencia]),
    ultimo_cobro: null,
    proximo_cobro: null,
  }
  s.ingresos.push(nuevo)
  rearmarIngresos()
  return nuevo
}

/** Reparte el monto mensual entre los eventos de pago, como el backend. */
function rearmarIngresos() {
  const programados: Estado['ingresos_programados'] = []
  let mensual = 0
  for (const f of s.ingresos) {
    if (!f.activo) continue
    mensual += f.monto_mensual
    const eventos = f.frecuencia === 'quincenal' ? 2 : 1
    const porEvento = f.monto_mensual / eventos
    for (const dia of [f.dia_pago, f.dia_pago_2].slice(0, eventos)) {
      if (dia) programados.push({ dia, monto: r2(porEvento), concepto: f.concepto })
    }
  }
  s.base.ingreso.mensual = r2(mensual)
  s.base.ingresos_programados = programados
}

// ----------------------------------------------------------- recurrentes
function agregarRecurrente(g: RecurrenteCreate): RecurrenteResumen {
  validarCategoria(g.categoria)
  const meses = g.frecuencia_meses ?? 1
  const nuevo: RecurrenteResumen = {
    id: String(siguienteId++),
    concepto: g.concepto,
    monto: g.monto,
    categoria: g.categoria,
    categoria_nombre: nombreCategoria(g.categoria) ?? g.categoria,
    dia_del_mes: g.dia_del_mes,
    frecuencia_meses: meses,
    es_variable: g.es_variable ?? false,
    ajuste_mes_corto: g.ajuste_mes_corto ?? 'ultimo_dia',
    fecha_inicio: g.fecha_inicio,
    fecha_fin: g.fecha_fin ?? null,
    activo: true,
    // AMORTIZADO: una luz de $900 bimestral pesa $450.
    peso_mensual: r2(g.monto / meses),
  }
  s.recurrentes.push(nuevo)
  rearmarCompromisos()
  return nuevo
}

function rearmarCompromisos() {
  s.base.compromisos = s.recurrentes
    .filter(r => r.activo)
    .map(r => ({ dia: r.dia_del_mes, monto: r.peso_mensual, concepto: r.concepto }))
  s.base.gastos.fijos = r2(
    s.recurrentes.filter(r => r.activo).reduce((a, r) => a + r.peso_mensual, 0),
  )
}

// ------------------------------------------------------------ pendientes
/**
 * NO sale de ninguna tabla: se deriva cruzando las declaraciones contra los
 * movimientos que ya hay, igual que el backend. Lo que ya se confirmó este mes
 * deja de estar pendiente.
 */
function derivarPendientes(): PendientesResponse {
  const hoyISO = isoHoy()
  const mes = hoyISO.slice(0, 7)
  const dia = Number(hoyISO.slice(8, 10))

  const enEsteMes = (id: string, campo: 'ingreso_id' | 'recurrente_id') =>
    s.movimientos.some(m => m[campo] === id && m.fecha.slice(0, 7) === mes)

  const fechaDe = (diaDelMes: number) =>
    `${mes}-${String(Math.min(diaDelMes, 28)).padStart(2, '0')}`

  // Un quincenal cae DOS veces en el mes: son dos pendientes con el mismo
  // origen_id, igual que en el servidor. El mock lo reproduce a proposito,
  // porque es el caso que rompe una lista mal llaveada.
  const ingresos = s.ingresos
    .filter(i => i.activo && !enEsteMes(i.id, 'ingreso_id'))
    .flatMap(i => {
      const dias = i.frecuencia === 'quincenal' && i.dia_pago_2
        ? [i.dia_pago ?? 1, i.dia_pago_2]
        : [i.dia_pago ?? 1]
      return dias.map(d => ({
        tipo: 'ingreso' as const,
        origen_id: i.id,
        concepto: i.concepto,
        fecha_esperada: fechaDe(d),
        monto_esperado: i.monto,
        monto_incierto: false,
        categoria: null,
        dias_restantes: d - dia,
      }))
    })

  const gastos = s.recurrentes
    .filter(r => r.activo && !enEsteMes(r.id, 'recurrente_id'))
    .map(r => ({
      tipo: 'recurrente' as const,
      origen_id: r.id,
      concepto: r.concepto,
      fecha_esperada: fechaDe(r.dia_del_mes),
      // COMPLETO, no amortizado: la pregunta es "me alcanza este mes".
      monto_esperado: r.monto,
      monto_incierto: r.es_variable,
      categoria: r.categoria,
      dias_restantes: r.dia_del_mes - dia,
    }))

  return {
    ingresos,
    gastos,
    total_por_cobrar: r2(ingresos.reduce((a, i) => a + i.monto_esperado, 0)),
    total_por_pagar: r2(gastos.reduce((a, g) => a + g.monto_esperado, 0)),
  }
}

// --------------------------------------------------------------- cortes
/**
 * Las cifras de un periodo ABIERTO son proyectadas y se mueven con cada gasto;
 * al cerrar dejan de hacerlo. Por eso se recalculan al leer mientras siga
 * abierto y se congelan en la fila cuando se cierra.
 */
function calcularPeriodo(p: PeriodoResumen): PeriodoResumen {
  if (p.cerrado) return p
  const t = buscarTarjeta(p.tarjeta_id)
  if (!t) return p

  const saldoAlCorte = t.saldo ?? 0
  // Lo que esta a meses no genera intereses: se resta del pago que los evita.
  const msiDelPeriodo = r2((t.msi ?? []).reduce((a, m) => a + m.monto_mensual, 0))
  const pagoNoIntereses = r2(Math.max(0, saldoAlCorte - msiDelPeriodo))
  const pagoMinimo = t.pago_minimo ?? 0
  const pagado = r2(s.movimientos
    .filter(m => m.tipo === 'pago' && m.tarjeta_id === t.id && m.fecha > p.fecha_corte)
    .reduce((a, m) => a + m.monto, 0))

  return {
    ...p,
    saldo_al_corte: saldoAlCorte,
    pago_minimo: pagoMinimo,
    pago_no_intereses: pagoNoIntereses,
    msi_del_periodo: msiDelPeriodo,
    pagado,
    falta_para_no_intereses: r2(Math.max(0, pagoNoIntereses - pagado)),
    falta_para_no_mora: r2(Math.max(0, pagoMinimo - pagado)),
  }
}

const diasHasta = (iso: string) => {
  const [a, m, d] = iso.split('-').map(Number)
  return Math.round((new Date(a, m - 1, d).getTime() - hoy().getTime()) / 86400000)
}

// ----------------------------------------------------------- movimientos
function anotarMovimiento(
  m: Partial<MovimientoResumen> & { tipo: TipoMovimiento; medio: MedioPago; monto: number; fecha: string },
): MovimientoResumen {
  const t = buscarTarjeta(m.tarjeta_id)
  const mov: MovimientoResumen = {
    id: String(siguienteId++),
    tipo: m.tipo,
    medio: m.medio,
    monto: m.monto,
    fecha: m.fecha,
    categoria: m.categoria ?? null,
    categoria_nombre: nombreCategoria(m.categoria),
    descripcion: m.descripcion ?? null,
    tarjeta_id: t?.id ?? null,
    tarjeta_nombre: t?.nombre ?? null,
    periodo_id: null,
    ingreso_id: m.ingreso_id ?? null,
    recurrente_id: m.recurrente_id ?? null,
  }
  s.movimientos.unshift(mov)
  return mov
}

/** Aplica el efecto sobre los saldos. Es la tabla del contrato, tal cual. */
function aplicarSaldos(m: MovimientoCreate) {
  if (m.tipo === 'gasto') {
    if (m.medio === 'credito') {
      const t = buscarTarjeta(m.tarjeta_id)!
      // Sube por el TOTAL, no por la mensualidad: el banco prestó el total.
      t.saldo = r2((t.saldo ?? 0) + m.monto)
    } else {
      s.base.liquidez = r2(s.base.liquidez - m.monto)
    }
  } else if (m.tipo === 'pago') {
    const t = buscarTarjeta(m.tarjeta_id)!
    s.base.liquidez = r2(s.base.liquidez - m.monto)
    t.saldo = r2(Math.max(0, (t.saldo ?? 0) - m.monto))
  } else {
    s.base.liquidez = r2(s.base.liquidez + m.monto)
  }
  s.usuario.saldo_disponible = s.base.liquidez
}

function componenteDe(m: MovimientoCreate) {
  if (m.tipo === 'gasto' && m.medio === 'credito') return 'utilizacion' as const
  if (m.tipo === 'pago') return 'deuda' as const
  return 'liquidez' as const
}

function registrarMovimiento(req: MovimientoCreate): MovimientoResponse {
  const errFecha = validarFecha(req.fecha)
  if (errFecha) throw reglaDeNegocio(errFecha)
  if (!(req.monto > 0)) throw validacion('monto', 'Input should be greater than 0')

  const errCombi = validarCombinacion(req)
  if (errCombi) throw reglaDeNegocio(errCombi)

  if (req.tipo === 'gasto') {
    if (!req.categoria) throw validacion('categoria', 'Field required')
    validarCategoria(req.categoria)
  }
  if (req.msi && req.medio !== 'credito') {
    throw reglaDeNegocio('Solo una compra a credito puede ir a meses')
  }

  if (req.tarjeta_id && !buscarTarjeta(req.tarjeta_id)) {
    throw noEncontrado(`Tarjeta no encontrada: ${req.tarjeta_id}`)
  }

  // Alcanza o no alcanza, con el mismo texto que redacta el servidor.
  if (req.tipo === 'gasto' && req.medio !== 'credito' && req.monto > s.base.liquidez) {
    throw reglaDeNegocio(`No alcanza: tu disponible es $${miles(s.base.liquidez)}`)
  }
  if (req.tipo === 'pago') {
    const t = buscarTarjeta(req.tarjeta_id)!
    if (req.monto > (t.saldo ?? 0)) {
      throw reglaDeNegocio(`El pago excede el saldo de ${t.nombre} ($${miles(t.saldo ?? 0)})`)
    }
    if (req.monto > s.base.liquidez) {
      throw reglaDeNegocio(`No alcanza: tu disponible es $${miles(s.base.liquidez)}`)
    }
  }
  if (req.tipo === 'gasto' && req.medio === 'credito') {
    const t = buscarTarjeta(req.tarjeta_id)!
    if (t.limite !== null && req.monto > t.limite - (t.saldo ?? 0)) {
      throw reglaDeNegocio(`Excede tu linea disponible en ${t.nombre}`)
    }
  }

  const antes = estadoMotor()
  const componente = componenteDe(req)

  aplicarSaldos(req)
  const mov = anotarMovimiento(req as never)

  if (req.msi) {
    const t = buscarTarjeta(req.tarjeta_id)!
    t.msi = [...(t.msi ?? []), {
      id: String(siguienteId++),
      tarjeta_id: t.id,
      descripcion: req.msi.descripcion ?? req.descripcion ?? null,
      monto_total: req.monto,
      monto_mensual: r2(req.monto / req.msi.meses),
      meses_totales: req.msi.meses,
      meses_restantes: req.msi.meses,
      saldo_pendiente: req.monto,
      fecha_inicio: req.fecha,
      movimiento_id: mov.id,
    }]
  }

  const despues = calcularScore(estadoMotor())
  const scoreAntes = calcularScore(antes)

  return {
    movimiento: mov,
    impacto: {
      score_antes: scoreAntes.score_exacto,
      score_despues: despues.score_exacto,
      componente_afectado: componente,
      componente_antes: scoreAntes.componentes[componente],
      componente_despues: despues.componentes[componente],
    },
    repetido: false,
  }
}

// ----------------------------------------------------------------- rutas
export async function mockRespuesta<T>(ruta: string, init: RequestInit): Promise<T> {
  await espera(LATENCIA)
  const metodo = (init.method ?? 'GET').toUpperCase()
  const [camino, consulta] = ruta.split('?')
  const params = new URLSearchParams(consulta ?? '')
  // El PDF del estado de cuenta viaja como FormData: JSON.parse lo rompería.
  // Ese cuerpo no se usa — el mock no lee el archivo, devuelve una lectura fija.
  const cuerpo = init.body && !(init.body instanceof FormData)
    ? JSON.parse(init.body as string)
    : undefined
  const clave = (init.headers as Record<string, string> | undefined)?.['Idempotency-Key']

  // Misma clave, misma respuesta, y el saldo NO se vuelve a mover.
  if (clave && yaUsadas.has(clave)) {
    const previa = yaUsadas.get(clave)
    return (
      previa && typeof previa === 'object' && 'movimiento' in previa
        ? { ...previa, repetido: true }
        : previa
    ) as T
  }

  const respuesta = resolver(metodo, camino, params, cuerpo)
  if (clave) yaUsadas.set(clave, respuesta)
  return respuesta as T
}

function resolver(
  metodo: string, camino: string, params: URLSearchParams, cuerpo: any,
): unknown {
  // ---------------------------------------------------------------- auth
  if (camino === '/auth/demo' && metodo === 'POST') {
    s = clonar(datos as unknown as EstadoMock)
    yaUsadas.clear()
    return { token: 'demo-mock', usuario_id: s.usuario.id, nombre: s.usuario.nombre }
  }
  if (camino === '/auth/login' && metodo === 'POST') {
    return { token: 'login-mock', usuario_id: s.usuario.id, nombre: s.usuario.nombre }
  }
  if (camino === '/auth/registro' && metodo === 'POST') {
    // Un usuario nuevo entra sin onboarding: así el wizard también es demoable
    // sin backend.
    s = clonar(datos as unknown as EstadoMock)
    yaUsadas.clear()
    s.usuario = {
      ...s.usuario,
      id: '99',
      nombre: cuerpo?.nombre ?? 'Nuevo',
      email: cuerpo?.email ?? 'nuevo@app.mx',
      es_demo: false,
      onboarding_completo: false,
      saldo_disponible: 0,
      version: 0,
    }
    s.base.liquidez = 0
    s.base.gastos = { fijos: 0, variables_prom: 0 }
    s.base.compromisos = []
    s.tarjetas = []
    s.ingresos = []
    s.recurrentes = []
    s.movimientos = []
    s.periodos = []
    rearmarIngresos()
    return { token: 'registro-mock', usuario_id: '99', nombre: s.usuario.nombre }
  }
  if (camino === '/auth/me' && metodo === 'GET') return s.usuario

  // ------------------------------------------------------------ catálogo
  if (camino === '/categorias' && metodo === 'GET') return sobre(s.categorias)

  // ------------------------------------------------------------- usuario
  if (camino === '/usuarios/me/liquidez' && metodo === 'PUT') {
    if (cuerpo?.version != null && cuerpo.version !== s.usuario.version) {
      throw conflicto('Tu saldo cambió mientras editabas',
        { version_actual: s.usuario.version })
    }
    if (!(cuerpo?.saldo >= 0)) throw validacion('saldo', 'Input should be greater than or equal to 0')
    if (!cuerpo?.motivo) throw validacion('motivo', 'Field required')
    s.base.liquidez = cuerpo.saldo
    s.usuario = {
      ...s.usuario, saldo_disponible: cuerpo.saldo, version: s.usuario.version + 1,
    }
    return s.usuario
  }

  // ---------------------------------------------------------- onboarding
  if (camino === '/onboarding' && metodo === 'POST') {
    if (s.usuario.onboarding_completo)
      throw conflicto('Ya completaste la captura inicial')
    const req = cuerpo as OnboardingRequest

    for (const i of req.ingresos ?? []) {
      const err = validarIngreso(i)
      if (err) throw reglaDeNegocio(err)
    }
    for (const t of req.tarjetas ?? []) {
      if (t.tipo === 'credito') {
        if (!t.terminos) throw reglaDeNegocio(`${t.nombre} necesita sus términos`)
        const err = validarTerminos(t.terminos)
        if (err) throw reglaDeNegocio(err)
      } else if (t.terminos) {
        throw reglaDeNegocio('Una tarjeta de débito no lleva términos')
      }
    }
    for (const g of req.gastos_fijos ?? []) {
      if (!g.fecha_inicio) throw validacion('fecha_inicio', 'Field required')
      validarCategoria(g.categoria)
    }

    // Todo o nada: se valida entero antes de escribir la primera fila.
    s.base.liquidez = req.liquidez
    s.usuario.saldo_disponible = req.liquidez
    s.ingresos = []
    for (const i of req.ingresos ?? []) agregarIngreso(i)

    for (const t of req.tarjetas ?? []) {
      const term = t.terminos
      s.tarjetas.push({
        id: String(siguienteId++), banco: t.banco, nombre: t.nombre, tipo: t.tipo,
        activa: true,
        limite: term?.limite ?? null,
        saldo: t.tipo === 'credito' ? (term?.saldo ?? null) : 0,
        disponible: term ? r2(term.limite - term.saldo) : null,
        tasa_anual: term?.tasa_anual ?? null,
        pago_minimo: term?.pago_minimo ?? null,
        dia_corte: term?.dia_corte ?? null,
        dia_limite_pago: term?.dia_limite_pago ?? null,
        monto_minimo_msi: term?.monto_minimo_msi ?? 0,
        // Los planes a meses ya no vienen aquí: llegan por POST /msi.
        msi: [],
        requiere_terminos: t.tipo === 'credito' && !term,
        version: 0,
      })
    }

    s.recurrentes = []
    for (const g of req.gastos_fijos ?? []) agregarRecurrente(g)
    s.usuario.onboarding_completo = true

    return {
      ok: true,
      liquidez: req.liquidez,
      ingresos_creados: (req.ingresos ?? []).length,
      tarjetas_creadas: (req.tarjetas ?? []).length,
      gastos_fijos_creados: (req.gastos_fijos ?? []).length,
      score_actualizado: calcularScore(estadoMotor()).score,
    }
  }

  // ------------------------------------------------------------ ingresos
  if (camino === '/ingresos' && metodo === 'GET') return sobre(s.ingresos)
  if (camino === '/ingresos' && metodo === 'POST') {
    const req = cuerpo as IngresoCreate
    const err = validarIngreso(req)
    if (err) throw reglaDeNegocio(err)
    return agregarIngreso(req)
  }

  const ingreso = camino.match(/^\/ingresos\/([^/]+)$/)
  if (ingreso) {
    const i = s.ingresos.find(x => x.id === ingreso[1])
    if (!i) throw noEncontrado(`Ingreso no encontrado: ${ingreso[1]}`)
    if (metodo === 'GET') return i
    if (metodo === 'PATCH') {
      Object.assign(i, cuerpo)
      i.monto_mensual = r2(i.monto * FACTOR_MENSUAL[i.frecuencia])
      rearmarIngresos()
      return i
    }
    if (metodo === 'DELETE') {
      s.ingresos = s.ingresos.filter(x => x.id !== i.id)
      rearmarIngresos()
      return undefined
    }
  }

  const confIngreso = camino.match(/^\/ingresos\/([^/]+)\/confirmaciones$/)
  if (confIngreso && metodo === 'POST') {
    const i = s.ingresos.find(x => x.id === confIngreso[1])
    if (!i) throw noEncontrado(`Ingreso no encontrado: ${confIngreso[1]}`)
    const c = cuerpo as ConfirmacionCreate
    const monto = c.monto ?? i.monto
    s.base.liquidez = r2(s.base.liquidez + monto)
    s.usuario.saldo_disponible = s.base.liquidez
    const fecha = c.fecha ?? isoHoy()
    anotarMovimiento({
      tipo: 'ingreso', medio: c.medio ?? 'debito', monto, fecha,
      descripcion: i.concepto, ingreso_id: i.id,
    })
    i.ultimo_cobro = fecha
    return { ok: true, score_actualizado: calcularScore(estadoMotor()).score }
  }

  // --------------------------------------------------------- recurrentes
  if (camino === '/recurrentes' && metodo === 'GET') return sobre(s.recurrentes)
  if (camino === '/recurrentes' && metodo === 'POST') {
    const req = cuerpo as RecurrenteCreate
    if (!req.fecha_inicio) throw validacion('fecha_inicio', 'Field required')
    return agregarRecurrente(req)
  }

  const historial = camino.match(/^\/recurrentes\/([^/]+)\/historial$/)
  if (historial && metodo === 'GET') {
    const r = s.recurrentes.find(x => x.id === historial[1])
    if (!r) throw noEncontrado(`Gasto fijo no encontrado: ${historial[1]}`)
    const pagos = s.movimientos
      .filter(m => m.recurrente_id === r.id)
      .slice(0, 6)
      .map(m => m.monto)
    const min = pagos.length ? Math.min(...pagos) : null
    const max = pagos.length ? Math.max(...pagos) : null
    return {
      recurrente_id: r.id,
      concepto: r.concepto,
      es_variable: r.es_variable,
      monto_declarado: r.monto,
      pagos_considerados: pagos.length,
      monto_min: min,
      monto_max: max,
      monto_promedio: pagos.length ? r2(pagos.reduce((a, b) => a + b, 0) / pagos.length) : null,
      ultimo_pago: s.movimientos.find(m => m.recurrente_id === r.id)?.fecha ?? null,
      // El MAXIMO reciente, no el promedio: quedarse corto es el error caro.
      monto_para_proyectar: max ?? r.monto,
    }
  }

  const confRecurrente = camino.match(/^\/recurrentes\/([^/]+)\/confirmaciones$/)
  if (confRecurrente && metodo === 'POST') {
    const r = s.recurrentes.find(x => x.id === confRecurrente[1])
    if (!r) throw noEncontrado(`Gasto fijo no encontrado: ${confRecurrente[1]}`)
    const c = cuerpo as ConfirmacionCreate
    // En un variable el monto no existe hasta que llega el recibo.
    if (r.es_variable && c.monto == null) {
      throw reglaDeNegocio(
        `${r.concepto} cambia cada vez: dinos de cuánto vino`, { campo: 'monto' },
      )
    }
    const monto = c.monto ?? r.monto
    if (monto > s.base.liquidez) {
      throw reglaDeNegocio(`No alcanza: tu disponible es $${miles(s.base.liquidez)}`)
    }
    s.base.liquidez = r2(s.base.liquidez - monto)
    s.usuario.saldo_disponible = s.base.liquidez
    anotarMovimiento({
      tipo: 'gasto', medio: c.medio ?? 'debito', monto,
      fecha: c.fecha ?? isoHoy(), categoria: r.categoria,
      descripcion: r.concepto, recurrente_id: r.id,
    })
    return { ok: true, score_actualizado: calcularScore(estadoMotor()).score }
  }

  const recurrente = camino.match(/^\/recurrentes\/([^/]+)$/)
  if (recurrente) {
    const r = s.recurrentes.find(x => x.id === recurrente[1])
    if (!r) throw noEncontrado(`Gasto fijo no encontrado: ${recurrente[1]}`)
    if (metodo === 'GET') return r
    if (metodo === 'PATCH') {
      if (cuerpo?.categoria) validarCategoria(cuerpo.categoria)
      Object.assign(r, cuerpo)
      r.categoria_nombre = nombreCategoria(r.categoria) ?? r.categoria
      r.peso_mensual = r2(r.monto / r.frecuencia_meses)
      rearmarCompromisos()
      return r
    }
    if (metodo === 'DELETE') {
      s.recurrentes = s.recurrentes.filter(x => x.id !== r.id)
      rearmarCompromisos()
      return undefined
    }
  }

  // ------------------------------------------------------------ pendientes
  if (camino === '/pendientes' && metodo === 'GET') return derivarPendientes()

  // -------------------------------------------------------------- cortes
  if (camino === '/pagos-pendientes' && metodo === 'GET') {
    const filas: PagoPendiente[] = []
    for (const p of (s.periodos ?? []).map(calcularPeriodo)) {
      if (p.falta_para_no_intereses <= 0 && p.falta_para_no_mora <= 0) continue
      const t = buscarTarjeta(p.tarjeta_id)
      if (!t) continue
      filas.push({
        tarjeta_id: t.id, banco: t.banco, tarjeta: t.nombre,
        fecha_corte: p.fecha_corte,
        fecha_limite_pago: p.fecha_limite_pago,
        dias_restantes: diasHasta(p.fecha_limite_pago),
        saldo_al_corte: p.saldo_al_corte,
        pago_minimo: p.pago_minimo,
        pago_no_intereses: p.pago_no_intereses,
        pagado: p.pagado,
        falta_para_no_intereses: p.falta_para_no_intereses,
        falta_para_no_mora: p.falta_para_no_mora,
      })
    }
    return sobre(filas)
  }

  const cierre = camino.match(/^\/tarjetas\/([^/]+)\/periodos\/([^/]+)\/cierre$/)
  if (cierre && metodo === 'POST') {
    const lista = s.periodos ?? []
    const i = lista.findIndex(p => p.id === cierre[2] && p.tarjeta_id === cierre[1])
    if (i < 0) throw noEncontrado(`Corte no encontrado: ${cierre[2]}`)
    if (lista[i].cerrado) throw conflicto('Ese corte ya está cerrado')
    // Congela las cifras: a partir de aquí dejan de moverse con cada gasto.
    lista[i] = { ...calcularPeriodo(lista[i]), cerrado: true }
    return lista[i]
  }

  const periodos = camino.match(/^\/tarjetas\/([^/]+)\/periodos$/)
  if (periodos) {
    const t = buscarTarjeta(periodos[1])
    if (!t) throw noEncontrado(`Tarjeta no encontrada: ${periodos[1]}`)
    if (metodo === 'GET') {
      return sobre(periodosDe(t.id).map(calcularPeriodo))
    }
    if (metodo === 'POST') {
      const req = cuerpo as PeriodoCreate
      if (periodosDe(t.id).some(p => !p.cerrado)) {
        throw conflicto(`${t.nombre} ya tiene un corte abierto`)
      }
      if (req.fecha_corte <= req.fecha_inicio) {
        throw reglaDeNegocio('El corte va después del inicio del periodo')
      }
      if (req.fecha_limite_pago <= req.fecha_corte) {
        throw reglaDeNegocio('La fecha límite de pago va después del corte')
      }
      const nuevo: PeriodoResumen = {
        id: String(siguienteId++),
        tarjeta_id: t.id,
        fecha_inicio: req.fecha_inicio,
        fecha_corte: req.fecha_corte,
        fecha_limite_pago: req.fecha_limite_pago,
        saldo_al_corte: 0, pago_minimo: 0, pago_no_intereses: 0,
        msi_del_periodo: 0, pagado: 0, intereses_generados: 0,
        cerrado: false, falta_para_no_intereses: 0, falta_para_no_mora: 0,
      }
      s.periodos = [nuevo, ...(s.periodos ?? [])]
      return calcularPeriodo(nuevo)
    }
  }

  // ----------------------------------------------------------------- msi
  if (camino === '/msi' && metodo === 'GET') {
    return sobre(s.tarjetas.flatMap(t => t.msi ?? []))
  }
  if (camino === '/msi' && metodo === 'POST') {
    const req = cuerpo as MSICreate
    const t = buscarTarjeta(req.tarjeta_id)
    if (!t) throw noEncontrado(`Tarjeta no encontrada: ${req.tarjeta_id}`)
    if (req.meses_restantes > req.meses_totales) {
      throw reglaDeNegocio('No pueden faltar más meses de los que dura el plan')
    }
    const nuevo: MSIResumen = {
      id: String(siguienteId++),
      tarjeta_id: t.id,
      descripcion: req.descripcion ?? null,
      monto_total: req.monto_total ?? r2(req.monto_mensual * req.meses_totales),
      monto_mensual: req.monto_mensual,
      meses_totales: req.meses_totales,
      meses_restantes: req.meses_restantes,
      saldo_pendiente: r2(req.monto_mensual * req.meses_restantes),
      fecha_inicio: req.fecha_inicio,
      // Capturado de un estado de cuenta: no hay compra en la app.
      movimiento_id: null,
    }
    t.msi = [...(t.msi ?? []), nuevo]
    return nuevo
  }

  const unMsi = camino.match(/^\/msi\/([^/]+)$/)
  if (unMsi && metodo === 'DELETE') {
    for (const t of s.tarjetas) {
      if ((t.msi ?? []).some(m => m.id === unMsi[1])) {
        t.msi = t.msi.filter(m => m.id !== unMsi[1])
        return undefined
      }
    }
    throw noEncontrado(`Plan a meses no encontrado: ${unMsi[1]}`)
  }

  // ------------------------------------------------------------ tarjetas
  if (camino === '/tarjetas' && metodo === 'GET') {
    return sobre(s.tarjetas.filter(t => t.activa).map(conDisponible))
  }
  if (camino === '/tarjetas' && metodo === 'POST') {
    const req = cuerpo as TarjetaCreate
    const nueva: TarjetaResumen = {
      id: String(siguienteId++), banco: req.banco, nombre: req.nombre,
      tipo: req.tipo, activa: true,
      limite: null, saldo: req.tipo === 'debito' ? 0 : null, disponible: null,
      tasa_anual: null, pago_minimo: null, dia_corte: null, dia_limite_pago: null,
      monto_minimo_msi: null, msi: [],
      requiere_terminos: req.tipo === 'credito',
      version: 0,
    }
    s.tarjetas.push(nueva)
    return nueva
  }

  const tarjeta = camino.match(/^\/tarjetas\/([^/]+)$/)
  if (tarjeta) {
    const t = buscarTarjeta(tarjeta[1])
    if (!t) throw noEncontrado(`Tarjeta no encontrada: ${tarjeta[1]}`)
    if (metodo === 'GET') return conDisponible(t)
    if (metodo === 'PATCH') {
      const req = cuerpo as TarjetaUpdate
      // Bloqueo optimista: si la versión no coincide, el guardado pisaría un
      // cambio que ocurrió con el formulario abierto.
      if (req.version != null && req.version !== t.version) {
        throw conflicto(
          'Esta tarjeta cambió mientras la editabas',
          { version_actual: t.version },
        )
      }
      const fusion = {
        limite: req.limite ?? t.limite ?? 0,
        saldo: req.saldo ?? t.saldo ?? 0,
        dia_corte: req.dia_corte ?? t.dia_corte ?? 1,
        dia_limite_pago: req.dia_limite_pago ?? t.dia_limite_pago ?? 2,
      }
      const err = validarTerminos(fusion)
      if (err) throw reglaDeNegocio(err)

      const { version: _v, ...cambios } = req
      Object.assign(t, cambios)
      const completa = t.limite !== null && t.saldo !== null && t.tasa_anual !== null
        && t.dia_corte !== null && t.dia_limite_pago !== null
      t.requiere_terminos = t.tipo === 'credito' && !completa
      t.version += 1
      return conDisponible(t)
    }
    if (metodo === 'DELETE') {
      // Baja lógica: los movimientos que la referencian se quedan.
      t.activa = false
      return undefined
    }
  }

  // --------------------------------------------------------- movimientos
  if (camino === '/movimientos' && metodo === 'GET') {
    const limite = Number(params.get('limite') ?? 50)
    const cursor = params.get('cursor')
    const tipo = params.get('tipo')
    const medio = params.get('medio')
    const categoria = params.get('categoria')
    const tarjetaId = params.get('tarjeta_id')
    const desde = params.get('desde')
    const hasta = params.get('hasta')

    const ordenados = [...s.movimientos]
      .filter(m => (!tipo || m.tipo === tipo)
        && (!medio || m.medio === medio)
        && (!categoria || m.categoria === categoria)
        && (!tarjetaId || m.tarjeta_id === tarjetaId)
        && (!desde || m.fecha >= desde)
        && (!hasta || m.fecha <= hasta))
      .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : Number(b.id) - Number(a.id)))

    // Cursor opaco `fecha:id`, con el mismo formato que el servidor. El
    // cliente nunca lo interpreta; aquí sí, porque aquí somos el servidor.
    const desdeCursor = cursor
      ? ordenados.findIndex(m => `${m.fecha}:${m.id}` === cursor) + 1
      : 0
    const pagina = ordenados.slice(desdeCursor, desdeCursor + limite)
    const ultimo = pagina[pagina.length - 1]
    const hayMas = desdeCursor + limite < ordenados.length

    return {
      data: pagina,
      meta: {
        hay_mas: hayMas,
        siguiente_cursor: hayMas && ultimo ? `${ultimo.fecha}:${ultimo.id}` : null,
        // null a propósito: contar una tabla que crece cuesta lo mismo que leerla.
        total: null,
      },
    }
  }

  if (camino === '/movimientos' && metodo === 'POST') {
    return registrarMovimiento(cuerpo as MovimientoCreate)
  }

  const movimiento = camino.match(/^\/movimientos\/([^/]+)$/)
  if (movimiento) {
    const m = s.movimientos.find(x => x.id === movimiento[1])
    if (!m) throw noEncontrado(`Movimiento no encontrado: ${movimiento[1]}`)
    if (metodo === 'GET') return m
    if (metodo === 'DELETE') {
      if (!cuerpo?.motivo) throw validacion('motivo', 'Field required')
      // REVIERTE el saldo: un borrado que no revierte es peor que no borrar.
      aplicarSaldos({
        tipo: m.tipo === 'ingreso' ? 'gasto' : m.tipo === 'gasto' ? 'ingreso' : 'gasto',
        medio: m.medio, monto: m.monto, fecha: m.fecha,
        tarjeta_id: m.tipo === 'gasto' && m.medio === 'credito' ? m.tarjeta_id : null,
      } as MovimientoCreate)
      if (m.tipo === 'pago' && m.tarjeta_id) {
        const t = buscarTarjeta(m.tarjeta_id)
        if (t) t.saldo = r2((t.saldo ?? 0) + m.monto)
      }
      s.movimientos = s.movimientos.filter(x => x.id !== m.id)
      return undefined
    }
  }

  // --------------------------------------------------- consulta y decisión
  if (camino === '/estado' && metodo === 'GET') return estadoMotor()
  if (camino === '/score' && metodo === 'GET') return calcularScore(estadoMotor())

  if (camino === '/simulaciones/compra' && metodo === 'POST') {
    return simularDelCuerpo(cuerpo as SimulacionRequest)
  }

  if (camino === '/deuda/prioridad' && metodo === 'GET') {
    const e = estadoMotor()
    return {
      ranking: priorizarDeudas(e),
      intereses_totales_mes: r2(interesesMensuales(e)),
    }
  }

  if (camino === '/deuda/pagos' && metodo === 'POST') {
    const req = cuerpo as PagoRequest
    const t = buscarTarjeta(req.tarjeta_id)
    if (!t) throw noEncontrado(`Tarjeta no encontrada: ${req.tarjeta_id}`)
    if (req.monto <= 0) throw reglaDeNegocio('El monto debe ser mayor a cero')
    if (req.monto > (t.saldo ?? 0))
      throw reglaDeNegocio(`El pago excede el saldo de ${t.nombre} ($${miles(t.saldo ?? 0)})`)
    if (req.monto > s.base.liquidez)
      throw reglaDeNegocio(`No alcanza: tu disponible es $${miles(s.base.liquidez)}`)

    const antes = estadoMotor()
    const impacto = evaluar(antes, {
      tipo: 'pago', monto: req.monto, tarjeta_id: req.tarjeta_id,
    })

    s.base.liquidez = r2(s.base.liquidez - req.monto)
    s.usuario.saldo_disponible = s.base.liquidez
    t.saldo = r2(Math.max(0, (t.saldo ?? 0) - req.monto))
    anotarMovimiento({
      tipo: 'pago', medio: req.medio ?? 'debito', monto: req.monto,
      fecha: req.fecha ?? isoHoy(), descripcion: `Pago a ${t.nombre}`,
      tarjeta_id: t.id,
    })

    return {
      ok: true,
      score_antes: impacto.antes.score,
      score_despues: impacto.despues.score,
      ahorro_intereses_mensual:
        r2(interesesMensuales(antes) - interesesMensuales(estadoMotor())),
      nuevo_saldo_tarjeta: t.saldo,
    }
  }

  // ------------------------------------------------------------------ IA
  // Estas dos las contesta Gemini en el servidor real. Aquí devuelven una
  // lectura fija: la demo del PDF tiene que correr sin internet y sin backend.

  if (/^\/tarjetas\/[^/]+\/extraccion$/.test(camino) && metodo === 'POST') {
    return mockExtraccion()
  }

  if (camino === '/deuda/explicacion' && metodo === 'GET') {
    return mockExplicacion(priorizarDeudas(estadoMotor()))
  }

  if (camino === '/simulaciones/analisis' && metodo === 'POST') {
    // Igual que el servidor real: se REHACE la simulación con el mismo cuerpo
    // en vez de recibir los escenarios ya calculados.
    return mockAnalisis(simularDelCuerpo(cuerpo as SimulacionRequest))
  }

  throw new ApiException(404, 'no_encontrado', `Ruta no simulada: ${metodo} ${camino}`)
}

/**
 * La simulación a partir del cuerpo, sin repetir la validación en dos rutas.
 *
 * La usan `/simulaciones/compra` y `/simulaciones/analisis`, que reciben
 * exactamente el mismo cuerpo: el análisis rehace la simulación en vez de
 * recibirla, igual que el servidor real.
 */
function simularDelCuerpo(req: SimulacionRequest) {
  if (!(req.monto > 0)) throw reglaDeNegocio('El monto debe ser mayor a cero')
  const invalidos = [
    ...(req.plazos ?? []),
    ...(req.tarjetas ?? []).flatMap(t => t.plazos),
  ].filter(p => !PLAZOS_COMUNES.includes(p))
  if (invalidos.length > 0) {
    throw validacion('plazos', `Plazos no soportados: ${[...new Set(invalidos)].join(', ')}`)
  }
  return simularCompra(
    estadoMotor(), req.monto, req.plazos ?? [],
    req.tarjetas ?? null, req.incluir_contado ?? true,
  )
}

// =====================================================================
// LAS TRES RESPUESTAS DE IA
// =====================================================================
// Venían de lib/gemini.ts, donde eran el respaldo de la llamada a Google.
// Siguen aquí porque el modo mock nunca fue sobre Gemini: es el seguro de vida
// de la presentación, y tiene que cubrir todo lo que la app pida por red.

/** Lo mismo que lee Gemini del estado de cuenta del demo, ya normalizado. */
function mockExtraccion(): ExtraccionResponse {
  return {
    valores: {
      limite: 28000,
      // El saldo sale del disponible impreso: 28000 - 22000.
      saldo: 6000,
      tasa_anual: 0.38,
      pago_minimo: 600,
      dia_corte: 15,
      dia_limite_pago: 5,
    },
    banco: 'BBVA',
    campos_ia: ['limite', 'disponible', 'tasa_pct', 'pago', 'dia_corte', 'dia_limite_pago'],
    avisos: [
      'Falta decir a cuantos meses fue cada compra: el estado de cuenta no lo imprime',
      'El monto minimo para MSI no viene en el estado de cuenta, capturalo tu',
    ],
    confianza: 'alta',
    pagos: { minimo: 600, sin_intereses: 6000 },
    disponible: 22000,
    planes: [{ descripcion: 'Celular', monto_mensual: 833, meses_restantes: 7 }],
  }
}

/** La misma redacción que produciría Gemini, sobre los números del motor. */
function mockExplicacion(ranking: DeudaRanking[]): ExplicacionDeudaResponse {
  const primera = ranking[0]
  if (!primera) {
    return {
      titular: 'No tienes deuda de tarjetas registrada',
      explicacion: 'Ninguna de tus tarjetas trae saldo pendiente.',
      siguiente_paso: 'Registra una tarjeta de crédito para ver aquí qué pagar primero.',
      comparativa: null,
      confianza: 'alta',
    }
  }
  const segunda = ranking[1]
  const pesos = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
  return {
    titular: `Empieza por ${primera.tarjeta}`,
    explicacion:
      `${primera.tarjeta} te cobra ${Math.round(primera.tasa * 100)}% anual y traes ` +
      `${pesos(primera.saldo)} de saldo. Cada mes se te van ` +
      `${pesos(primera.costo_intereses_mes)} solo en intereses de esa tarjeta. ` +
      `Además la traes al ${primera.utilizacion}% de su límite.`,
    siguiente_paso:
      `Abona hoy lo que puedas a ${primera.tarjeta}, idealmente el pago para no generar intereses.`,
    comparativa: segunda
      ? `${segunda.tarjeta} puede esperar: cobra ${Math.round(segunda.tasa * 100)}% anual ` +
        `y te cuesta ${pesos(segunda.costo_intereses_mes)} al mes.`
      : null,
    confianza: 'alta',
  }
}

/**
 * El análisis profundo, redactado sobre los números que ya produjo el motor.
 *
 * Es exactamente lo que hace Gemini en el servidor: NO calcula nada. El
 * veredicto y sus razones vienen de la simulación tal cual; aquí solo se
 * ponen en oraciones. Si esta función inventara una cifra, el modo mock
 * dejaría de ser una réplica y pasaría a ser una mentira bonita.
 */
function mockAnalisis(sim: SimulacionResponse): AnalisisCompraResponse {
  const rec = sim.recomendado
  const pesos = (n: number | null) =>
    n === null ? '—' : '$' + Math.round(n).toLocaleString('en-US')

  if (!rec) {
    return {
      titular: 'Hoy no hay forma de pagarlo',
      explicacion:
        'Ninguna de las formas de pago que pusiste sobre la mesa alcanza para ' +
        `${pesos(sim.monto)}. Ni tu efectivo ni la línea disponible de tus tarjetas.`,
      comparativas: [],
      reflexion: '¿Puede esperar a que entre tu próximo ingreso?',
      riesgos: sim.razones_veredicto,
      confianza: 'alta',
      veredicto: sim.veredicto,
      razones_veredicto: sim.razones_veredicto,
      categoria: 'otros',
      categoria_nombre: nombreCategoria('otros') ?? 'Otros',
    }
  }

  // Una fila por tarjeta (y el contado), igual que lo que viaja al modelo real.
  const vistos = new Set<string | null>()
  const opciones = sim.escenarios.filter(e => {
    if (vistos.has(e.tarjeta_id)) return false
    vistos.add(e.tarjeta_id)
    return true
  })

  const comparativas = opciones
    .filter(o => o !== rec)
    .slice(0, 3)
    .map(o => {
      const nombre = nombreModalidad(o.modalidad, o.tarjeta)
      if (!o.viable) return `${nombre} no es opción: ${o.motivo}.`
      if (o.modalidad === 'contado') {
        return `De contado te quedarías con ${pesos(o.holgura_despues)} en efectivo ` +
          `y tu score bajaría a ${o.score_despues}.`
      }
      const extra = (o.costo_total ?? 0) - (rec.costo_total ?? 0)
      return extra > 1
        ? `${nombre} te costaría ${pesos(extra)} más en total.`
        : `${nombre} deja tu score en ${o.score_despues}, contra ${rec.score_despues} de la recomendada.`
    })

  const nombreRec = nombreModalidad(rec.modalidad, rec.tarjeta)
  return {
    // Solo la primera letra: `toLowerCase()` sobre la frase entera dejaba
    // "con bbva", y el nombre del banco no se escribe así.
    titular: `Te conviene ${nombreRec[0].toLowerCase()}${nombreRec.slice(1)}`,
    explicacion:
      rec.modalidad === 'contado'
        ? `Pagarlo de una sale de tu efectivo y no te deja deuda. Te quedarían ` +
          `${pesos(rec.holgura_despues)} disponibles y tu score quedaría en ${rec.score_despues}.`
        : `Pagas ${pesos(rec.pago_mensual)} al mes y el total te sale en ` +
          `${pesos(rec.costo_total)}. Tu score quedaría en ${rec.score_despues}, ` +
          `contra ${sim.score_actual} de hoy.`,
    comparativas,
    reflexion: sim.veredicto === 'conviene'
      ? null
      : '¿Es algo que necesitas este mes, o puede esperar a que tu colchón se recupere?',
    riesgos: sim.razones_veredicto,
    confianza: 'alta',
    veredicto: sim.veredicto,
    razones_veredicto: sim.razones_veredicto,
    categoria: categoriaPorDescripcion(),
    categoria_nombre: nombreCategoria(categoriaPorDescripcion()) ?? 'Otros',
  }

  /**
   * El servidor real le pide al modelo que elija una clave del catálogo. Aquí
   * no hay modelo, así que se usa "otros": inventar una heurística de palabras
   * daría una categoría distinta a la del backend para la misma compra, y el
   * modo mock dejaría de reproducirlo.
   */
  function categoriaPorDescripcion(): string {
    return 'otros'
  }
}