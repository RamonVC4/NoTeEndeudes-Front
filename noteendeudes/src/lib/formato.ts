/**
 * Formato de cifras y fechas. Único lugar del proyecto donde se decide
 * cómo se ve un peso, un porcentaje o un color de banda.
 */
import type { ColorBanda, Componente, Modalidad, Veredicto } from './tipos'

// ---------------------------------------------------------------- dinero
/** $1,250 si es entero, $1,250.50 si no. */
export function mxn(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const decimales = Number.isInteger(n) ? 0 : 2
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(n)
}

/** Sin decimales nunca. Para ejes de gráfica y cifras de un vistazo. */
export function mxnRedondo(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(n)
}

/** $18k para el eje de la gráfica, donde no cabe el número completo. */
export function mxnCorto(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1000) return `${n < 0 ? '-' : ''}$${Math.round(abs / 1000)}k`
  return `${n < 0 ? '-' : ''}$${Math.round(abs)}`
}

// ----------------------------------------------------------- porcentajes
/** El backend manda fracción: pct(0.38) -> "38%". */
export const pct = (fraccion: number | null | undefined, decimales = 0): string =>
  fraccion === null || fraccion === undefined
    ? '—'
    : `${(fraccion * 100).toFixed(decimales)}%`

/** Algunos campos ya vienen en porcentaje (utilizacion: 85.0). */
export const pctYa = (n: number | null | undefined, decimales = 0): string =>
  n === null || n === undefined ? '—' : `${n.toFixed(decimales)}%`

/** +19 / -19 / 0, para los deltas de score. */
export const conSigno = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : n > 0 ? `+${n}` : `${n}`

// ---------------------------------------------------------------- fechas
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/**
 * Parsea YYYY-MM-DD como fecha local. `new Date('2026-08-31')` la lee como
 * UTC y en México se pinta un día antes.
 */
export function parseISO(iso: string): Date {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(a, (m ?? 1) - 1, d ?? 1)
}

export function hoyISO(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export function haceUnAnoISO(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 1)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** "31 de agosto" */
export function fecha(iso: string): string {
  const d = parseISO(iso)
  return `${d.getDate()} de ${MESES[d.getMonth()]}`
}

/** "Hoy", "Ayer" o "sábado 31 de agosto" — para los encabezados de grupo. */
export function fechaRelativa(iso: string): string {
  if (iso === hoyISO()) return 'Hoy'
  const ayer = new Date()
  ayer.setDate(ayer.getDate() - 1)
  const mm = String(ayer.getMonth() + 1).padStart(2, '0')
  const dd = String(ayer.getDate()).padStart(2, '0')
  if (iso === `${ayer.getFullYear()}-${mm}-${dd}`) return 'Ayer'
  const d = parseISO(iso)
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`
}

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * "Domingo 06 de Septiembre de 2026" — encabezado de pantalla. Día y mes en
 * mayúscula y día con cero a la izquierda: aquí la fecha es un rótulo, no parte
 * de una oración como en `fecha()` o `fechaRelativa()`.
 */
export function fechaLarga(iso: string): string {
  const d = parseISO(iso)
  const dia = String(d.getDate()).padStart(2, '0')
  return `${mayuscula(DIAS[d.getDay()])} ${dia} de ${mayuscula(MESES[d.getMonth()])} de ${d.getFullYear()}`
}

/** "día 15 de cada mes" */
export const diaDelMes = (n: number): string => `día ${n} de cada mes`

// ---------------------------------------------------------------- color
/**
 * El backend dice el color; aquí solo se traduce a token. Ningún componente
 * elige colores por su cuenta: el color saturado solo aparece cuando el
 * dinero del usuario lo dicta.
 */
const TOKEN_COLOR: Record<ColorBanda, string> = {
  verde: 'var(--verde)',
  amarillo: 'var(--ambar)',
  naranja: 'var(--naranja)',
  rojo: 'var(--rojo)',
}

export const colorBanda = (color: ColorBanda | string | null | undefined): string =>
  TOKEN_COLOR[(color ?? '') as ColorBanda] ?? 'var(--tinta-suave)'

/**
 * Misma tabla de bandas que documenta la API. Se usa donde el backend manda
 * un score suelto sin su color (score_despues del simulador).
 */
export function bandaDeScore(score: number): { banda: string; color: ColorBanda } {
  if (score >= 80) return { banda: 'Saludable', color: 'verde' }
  if (score >= 60) return { banda: 'Estable', color: 'amarillo' }
  if (score >= 40) return { banda: 'En riesgo', color: 'naranja' }
  return { banda: 'Crítico', color: 'rojo' }
}

// -------------------------------------------------------------- etiquetas
export const NOMBRE_COMPONENTE: Record<Componente, string> = {
  liquidez: 'Liquidez',
  deuda: 'Deuda',
  utilizacion: 'Utilización',
  flujo: 'Flujo',
}

export const EXPLICA_COMPONENTE: Record<Componente, string> = {
  liquidez: 'Cuántos meses aguantas con lo que tienes hoy',
  deuda: 'Qué tanto de tu ingreso se va en pagos',
  utilizacion: 'Cuánto de tu línea de crédito traes usada',
  flujo: 'Si el dinero te alcanza día con día',
}

/** "12 meses sin intereses con BBVA", "De contado", "Revolvente con NU". */
export function nombreModalidad(
  modalidad: Modalidad | null,
  tarjeta: string | null,
): string {
  if (modalidad === null) return tarjeta ? `Con ${tarjeta}` : 'Sin opción'
  if (modalidad === 'contado') return 'De contado'
  if (modalidad === 'credito') return `A crédito con ${tarjeta}`
  const meses = modalidad.split('_')[0]
  return `${meses} meses sin intereses con ${tarjeta}`
}

// ------------------------------------------------------------- veredicto
/**
 * El veredicto lo emite el MOTOR, no la IA. Aquí solo se traduce a palabras y
 * a token de color, igual que `colorBanda` hace con el score: ninguna pantalla
 * decide por su cuenta cuándo pintar rojo.
 */
export const NOMBRE_VEREDICTO: Record<Veredicto, string> = {
  conviene: 'Tu dinero lo aguanta',
  conviene_con_cuidado: 'Se puede, pero con cuidado',
  no_conviene: 'Esto te va a doler',
}

const COLOR_VEREDICTO: Record<Veredicto, ColorBanda> = {
  conviene: 'verde',
  conviene_con_cuidado: 'amarillo',
  no_conviene: 'rojo',
}

export const colorVeredicto = (v: Veredicto): string =>
  colorBanda(COLOR_VEREDICTO[v])

/** Versión corta para chips y listas apretadas. */
export function modalidadCorta(modalidad: Modalidad | null): string {
  if (modalidad === null) return 'No disponible'
  if (modalidad === 'contado') return 'Contado'
  if (modalidad === 'credito') return 'Revolvente'
  return `${modalidad.split('_')[0]} MSI`
}