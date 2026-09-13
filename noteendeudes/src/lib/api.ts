/**
 * Cliente HTTP del contrato /api/v1.
 *
 * Tres cosas que este archivo impone y las pantallas ya no tienen que recordar:
 *
 *   1. Todo cuelga de `/api/v1`. `BASE_URL` sale del contrato, no de aquí.
 *   2. Las colecciones vienen con sobre `{data, meta}`. `coleccion()` lo
 *      devuelve entero: `meta.siguiente_cursor` es opaco y hay que poder
 *      pasarlo tal cual como `?cursor=`.
 *   3. Los POST que mueven dinero llevan `Idempotency-Key`. La clave la genera
 *      la pantalla con `useClaveIdempotencia()` — una por gesto, no por
 *      petición.
 *
 * Y el desvío a lib/mock.ts cuando VITE_MOCK=1.
 */
import { BASE_URL } from './tipos'
import type {
  CategoriaResumen, Coleccion, Confirmacion, ConfirmacionCreate, DeudaResponse,
  Estado, IngresoCreate, IngresoResumen, IngresoUpdate, LiquidezUpdate,
  MovimientoCreate, MovimientoResponse, MovimientoResumen, MSICreate,
  MSIResumen, OnboardingRequest, OnboardingResponse, PagoPendiente, PagoRequest,
  PagoResponse, PendientesResponse, PeriodoCreate, PeriodoResumen,
  RecurrenteCreate, RecurrenteHistorial, RecurrenteResumen, RecurrenteUpdate,
  ScoreResponse, SimulacionRequest, SimulacionResponse, TarjetaCreate,
  TarjetaResumen, TarjetaUpdate, TokenResponse, UsuarioResumen,
} from './tipos'
import type {
  CodigoError, DetalleError, LoginRequest, RegistroRequest,
} from './ui-tipos'

const ORIGEN = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const BASE = `${ORIGEN}${BASE_URL}`

/** Seguro de vida: con VITE_MOCK=1 la app entera corre sin red. */
export const MOCK = import.meta.env.VITE_MOCK === '1'

export class ApiException extends Error {
  constructor(
    public status: number,
    public codigo: CodigoError,
    mensaje: string,
    public detalle: DetalleError = {},
  ) {
    super(mensaje)
    this.name = 'ApiException'
  }

  /** Alias legible de message: es el texto que manda el backend. */
  get mensaje(): string {
    return this.message
  }

  /** Los campos que marcó un 422 de validación. */
  get campos(): string[] {
    return (this.detalle?.campos ?? []).map(c => c.campo)
  }

  /** El mensaje del backend ya viene redactado para el usuario. */
  get esDeNegocio(): boolean {
    return this.codigo === 'regla_de_negocio' || this.codigo === 'conflicto'
  }

  /** 409 por bloqueo optimista: la fila cambió mientras el formulario estaba abierto. */
  get versionActual(): number | null {
    const v = this.detalle?.version_actual
    return typeof v === 'number' ? v : null
  }
}

interface Opciones extends RequestInit {
  /** Se manda como cabecera Idempotency-Key. Una por gesto del usuario. */
  clave?: string
}

async function api<T>(ruta: string, init: Opciones = {}): Promise<T> {
  const { clave, ...resto } = init

  if (MOCK) {
    const { mockRespuesta } = await import('./mock')
    return mockRespuesta<T>(ruta, init)
  }

  const token = localStorage.getItem('token')

  // Un FormData tiene que ir SIN Content-Type: el navegador pone el suyo con
  // el `boundary`, y fijarlo a mano rompe el multipart en el servidor.
  const esArchivo = resto.body instanceof FormData

  let res: Response
  try {
    res = await fetch(`${BASE}${ruta}`, {
      ...resto,
      headers: {
        ...(esArchivo ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(clave ? { 'Idempotency-Key': clave } : {}),
        ...resto.headers,
      },
    })
  } catch {
    // El backend no contestó. No es un error del contrato, es la red.
    throw new ApiException(
      0, 'sin_red',
      'No se pudo conectar con el servidor. Revisa que el backend esté corriendo.',
    )
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const e = body?.error
    if (res.status === 401) {
      localStorage.removeItem('token')
      // Sin recarga dura si ya estamos en login: evita el bucle.
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
    }
    throw new ApiException(
      res.status,
      e?.codigo ?? 'desconocido',
      e?.mensaje ?? 'Ocurrió un error inesperado',
      e?.detalle ?? {},
    )
  }

  // 204: los DELETE no devuelven cuerpo y res.json() reventaría.
  if (res.status === 204) return undefined as T

  return res.json() as Promise<T>
}

const empaquetar = (b: unknown) => (b === undefined ? undefined : JSON.stringify(b))

export const get = <T>(r: string) => api<T>(r)
export const post = <T>(r: string, body?: unknown, clave?: string) =>
  api<T>(r, { method: 'POST', body: empaquetar(body), clave })
/**
 * POST multipart. El único que no manda JSON: el PDF del estado de cuenta
 * viaja como archivo, sin el 33% que le agregaría codificarlo en base64.
 */
export const subir = <T>(r: string, form: FormData) =>
  api<T>(r, { method: 'POST', body: form })
export const patch = <T>(r: string, body: unknown) =>
  api<T>(r, { method: 'PATCH', body: empaquetar(body) })
export const put = <T>(r: string, body: unknown) =>
  api<T>(r, { method: 'PUT', body: empaquetar(body) })
/** DELETE con cuerpo opcional: /movimientos/{id} exige `{motivo}`. */
export const del = (r: string, body?: unknown) =>
  api<void>(r, { method: 'DELETE', body: empaquetar(body) })

/** Toda colección viene con sobre. Se devuelve entero por `meta`. */
const coleccion = <T>(r: string) => get<Coleccion<T>>(r)

/** Arma `?a=1&b=2` saltándose lo vacío. `cursor` viaja tal cual: es opaco. */
function query(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

// ------------------------------------------------------------------ auth
export const entrarDemo = () => post<TokenResponse>('/auth/demo')
export const login = (b: LoginRequest) => post<TokenResponse>('/auth/login', b)
export const registro = (b: RegistroRequest) => post<TokenResponse>('/auth/registro', b)
export const yo = () => get<UsuarioResumen>('/auth/me')

// -------------------------------------------------------------- catálogo
/** Público: se puede pedir antes del login. Se manda `clave`, se muestra `nombre`. */
export const categorias = () => coleccion<CategoriaResumen>('/categorias')

// --------------------------------------------------------------- usuario
/**
 * Corregir el saldo ("mi banco dice otra cosa"). NO es un movimiento: deja fila
 * en auditoría porque un saldo que cambia sin movimiento que lo explique tiene
 * que ser rastreable. Para dinero que de verdad entró, POST /movimientos con
 * tipo "ingreso".
 */
export const actualizarLiquidez = (b: LiquidezUpdate) =>
  put<UsuarioResumen>('/usuarios/me/liquidez', b)

// ----------------------------------------------------------- onboarding
export const onboarding = (b: OnboardingRequest) =>
  post<OnboardingResponse>('/onboarding', b)

// -------------------------------------------------------------- ingresos
export const ingresos = () => coleccion<IngresoResumen>('/ingresos')
export const crearIngreso = (b: IngresoCreate) => post<IngresoResumen>('/ingresos', b)
export const actualizarIngreso = (id: string, b: IngresoUpdate) =>
  patch<IngresoResumen>(`/ingresos/${id}`, b)
export const borrarIngreso = (id: string) => del(`/ingresos/${id}`)
export const confirmarIngreso = (id: string, b: ConfirmacionCreate, clave?: string) =>
  post<Confirmacion>(`/ingresos/${id}/confirmaciones`, b, clave)

// ----------------------------------------------------------- recurrentes
export const recurrentes = () => coleccion<RecurrenteResumen>('/recurrentes')
export const crearRecurrente = (b: RecurrenteCreate) =>
  post<RecurrenteResumen>('/recurrentes', b)
export const actualizarRecurrente = (id: string, b: RecurrenteUpdate) =>
  patch<RecurrenteResumen>(`/recurrentes/${id}`, b)
export const borrarRecurrente = (id: string) => del(`/recurrentes/${id}`)
/** El rango real de un variable, de los últimos 6 pagos. */
export const historialRecurrente = (id: string) =>
  get<RecurrenteHistorial>(`/recurrentes/${id}/historial`)
export const confirmarRecurrente = (id: string, b: ConfirmacionCreate, clave?: string) =>
  post<Confirmacion>(`/recurrentes/${id}/confirmaciones`, b, clave)

// ------------------------------------------------------------ pendientes
/** No sale de ninguna tabla: se deriva cruzando declaraciones contra movimientos. */
export const pendientes = () => get<PendientesResponse>('/pendientes')

// -------------------------------------------------------------- tarjetas
export const tarjetas = () => coleccion<TarjetaResumen>('/tarjetas')
export const tarjeta = (id: string) => get<TarjetaResumen>(`/tarjetas/${id}`)
export const crearTarjeta = (b: TarjetaCreate) => post<TarjetaResumen>('/tarjetas', b)
/** Parcial y con `version`, o pisas cambios ajenos (409 con detalle.version_actual). */
export const actualizarTarjeta = (id: string, b: TarjetaUpdate) =>
  patch<TarjetaResumen>(`/tarjetas/${id}`, b)
export const borrarTarjeta = (id: string) => del(`/tarjetas/${id}`)

// ---------------------------------------------------------------- cortes
export const periodos = (tarjetaId: string) =>
  coleccion<PeriodoResumen>(`/tarjetas/${tarjetaId}/periodos`)
export const abrirPeriodo = (tarjetaId: string, b: PeriodoCreate) =>
  post<PeriodoResumen>(`/tarjetas/${tarjetaId}/periodos`, b)
/** Explícito, no un cron: la app es una foto del presente. */
export const cerrarPeriodo = (tarjetaId: string, periodoId: string) =>
  post<PeriodoResumen>(`/tarjetas/${tarjetaId}/periodos/${periodoId}/cierre`)
export const pagosPendientes = () => coleccion<PagoPendiente>('/pagos-pendientes')

// ------------------------------------------------------------------- msi
export const msi = () => coleccion<MSIResumen>('/msi')
/**
 * Solo para planes capturados de un ESTADO DE CUENTA (quedan con
 * `movimiento_id: null`). Una compra nueva usa el bloque `msi` de
 * POST /movimientos, y así la compra y su plan nacen en la misma transacción.
 */
export const crearMSI = (b: MSICreate) => post<MSIResumen>('/msi', b)
export const borrarMSI = (id: string) => del(`/msi/${id}`)

// ----------------------------------------------------------- movimientos
export interface FiltrosMovimientos {
  limite?: number
  /** El `siguiente_cursor` de la respuesta anterior. Opaco: pásalo tal cual. */
  cursor?: string | null
  tipo?: string
  medio?: string
  categoria?: string
  tarjeta_id?: string
  desde?: string
  hasta?: string
}

export const movimientos = (f: FiltrosMovimientos = {}) =>
  coleccion<MovimientoResumen>(`/movimientos${query({ limite: 50, ...f })}`)

export const movimiento = (id: string) => get<MovimientoResumen>(`/movimientos/${id}`)

/** 201 normal; 200 con `repetido: true` si la clave ya se había usado. */
export const registrarMovimiento = (b: MovimientoCreate, clave?: string) =>
  post<MovimientoResponse>('/movimientos', b, clave)

/** Revierte el saldo en la misma transacción. El motivo es obligatorio. */
export const borrarMovimiento = (id: string, motivo: string) =>
  del(`/movimientos/${id}`, { motivo })

// --------------------------------------------------- consulta y decisión
export const estado = () => get<Estado>('/estado')
export const score = () => get<ScoreResponse>('/score')
export const simular = (b: SimulacionRequest) =>
  post<SimulacionResponse>('/simulaciones/compra', b)
export const prioridad = () => get<DeudaResponse>('/deuda/prioridad')
export const pagarDeuda = (b: PagoRequest, clave?: string) =>
  post<PagoResponse>('/deuda/pagos', b, clave)