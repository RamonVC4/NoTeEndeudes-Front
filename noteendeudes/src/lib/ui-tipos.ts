/**
 * Lo que es del FRONTEND y el contrato no declara.
 *
 * `lib/tipos.ts` es copia literal de `api-finance-v1/contrato/tipos.ts`, el
 * archivo que `python -m scripts.verificar_contrato` valida contra el OpenAPI
 * real. Si le agregamos cosas nuestras, esa verificación deja de significar
 * algo. Así que todo lo que inventamos aquí vive en este archivo.
 */
import type { ApiError, Estado, Frecuencia, ScoreResponse, TarjetaEstado } from './tipos'

// ------------------------------------------------------------------ auth
// Existen en el backend (app/schemas/auth.py) pero no en contrato/tipos.ts,
// que solo espeja modelos de respuesta.
export interface RegistroRequest { nombre: string; email: string; password: string }
export interface LoginRequest { email: string; password: string }

// --------------------------------------------------------------- errores
/**
 * Los códigos del contrato MÁS los dos que inventa el cliente: `sin_red`
 * cuando el fetch ni siquiera sale, y `desconocido` cuando la respuesta no
 * trae sobre de error (un 502 de un proxy, por ejemplo).
 */
export type CodigoError = ApiError['error']['codigo'] | 'sin_red' | 'desconocido'
export type DetalleError = ApiError['error']['detalle']

// ------------------------------------------------------------ frecuencias
export const FRECUENCIAS: { valor: Frecuencia; etiqueta: string }[] = [
  { valor: 'semanal', etiqueta: 'Cada semana' },
  { valor: 'catorcenal', etiqueta: 'Cada 14 días' },
  { valor: 'quincenal', etiqueta: 'Quincenal (dos veces al mes)' },
  { valor: 'mensual', etiqueta: 'Cada mes' },
]

/**
 * DOS FAMILIAS, y el formulario tiene que ramificar.
 *
 * La versión anterior exigía `dia_pago_2` en catorcenal, que es justo lo que
 * el esquema prohíbe: un catorcenal son 26 pagos al año —meses con dos y meses
 * con tres— y eso no es expresable como días del mes. Se ancla a una fecha de
 * cobro real y se cuenta en días.
 */
export type FamiliaFrecuencia = 'ancla' | 'dos_dias' | 'un_dia'

export const familiaFrecuencia = (f: Frecuencia): FamiliaFrecuencia =>
  f === 'semanal' || f === 'catorcenal' ? 'ancla'
    : f === 'quincenal' ? 'dos_dias'
    : 'un_dia'

/** Para el "al mes son…" en vivo. El backend normaliza igual. */
export const FACTOR_MENSUAL: Record<Frecuencia, number> = {
  semanal: 52 / 12, catorcenal: 26 / 12, quincenal: 2, mensual: 1,
}

// ------------------------------------------------------- recurrentes
/** `frecuencia_meses` de RecurrenteCreate: 1 mensual … 12 anual. */
export const FRECUENCIAS_MESES: { valor: number; etiqueta: string }[] = [
  { valor: 1, etiqueta: 'Cada mes' },
  { valor: 2, etiqueta: 'Cada 2 meses' },
  { valor: 3, etiqueta: 'Cada 3 meses' },
  { valor: 6, etiqueta: 'Cada 6 meses' },
  { valor: 12, etiqueta: 'Cada año' },
]

export const AJUSTES_MES_CORTO = [
  { valor: 'ultimo_dia', etiqueta: 'El último día del mes' },
  { valor: 'mes_siguiente', etiqueta: 'El 1 del mes siguiente' },
] as const

/** "Cada 2 meses" a partir del número, para pintar una lista. */
export const periodicidad = (meses: number): string =>
  FRECUENCIAS_MESES.find(f => f.valor === meses)?.etiqueta ?? `Cada ${meses} meses`

// ------------------------------------------------ formas inline con nombre
/**
 * El contrato declara estas formas dentro de su objeto padre, sin nombre
 * propio. Se derivan en vez de copiarse: escritas a mano divergirian en
 * silencio la primera vez que el backend agregue un campo.
 */
export type Flujo30d = ScoreResponse['flujo_30d']
export type IngresoProgramado = Estado['ingresos_programados'][number]
export type Compromiso = Estado['compromisos'][number]
export type MSIEnEstado = TarjetaEstado['msi'][number]