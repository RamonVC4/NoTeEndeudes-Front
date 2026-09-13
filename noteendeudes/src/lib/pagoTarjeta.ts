/**
 * Cómo paga el usuario cada tarjeta.
 *
 * El contrato congelado guarda UN solo número de pago mensual por tarjeta
 * (`pago_minimo`), y ese número alimenta obligaciones_mensuales y el cargo del
 * día de pago en la proyección de 30 días. Pero no significa lo mismo si
 * pagas el mínimo que si pagas todo para no generar intereses, y el backend
 * no tiene dónde guardar cuál de los dos capturaste.
 *
 * El modo vive en localStorage: es una preferencia de presentación, no un dato
 * financiero. Si falta (otro navegador, otro dispositivo), la tarjeta usa una
 * etiqueta neutra en vez de afirmar algo que no sabe.
 */
// Ahora es del contrato: el backend lo recibe en POST /tarjetas/{id}/extraccion
// para decidir cual de los dos pagos impresos prellena. Se reexporta para no
// tener dos definiciones del mismo par de literales.
export type { ModoPago } from './tipos'
import type { ModoPago } from './tipos'

const LLAVE = 'modo_pago_tarjeta'

type Mapa = Record<string, ModoPago>

function leerMapa(): Mapa {
  try {
    return JSON.parse(localStorage.getItem(LLAVE) ?? '{}') as Mapa
  } catch {
    return {}
  }
}

export function modoDe(tarjetaId: string): ModoPago | null {
  return leerMapa()[tarjetaId] ?? null
}

export function guardarModo(tarjetaId: string, modo: ModoPago): void {
  try {
    localStorage.setItem(LLAVE, JSON.stringify({ ...leerMapa(), [tarjetaId]: modo }))
  } catch {
    // Sin localStorage la app sigue funcionando: solo se pierde la etiqueta.
  }
}

/** Cómo se llama el número en el formulario. */
export const ETIQUETA_PAGO: Record<ModoPago, string> = {
  minimo: 'Pago mínimo',
  total: 'Pago para no generar intereses',
}

export const AYUDA_PAGO: Record<ModoPago, string> = {
  minimo: 'El más chico que te acepta el banco sin caer en mora',
  total: 'El total que te pide el banco para no cobrarte intereses',
}

/** Cómo se llama en la ficha, donde el modo puede venir vacío. */
export const etiquetaEnFicha = (modo: ModoPago | null): string =>
  modo === null ? 'Pagas al mes' : ETIQUETA_PAGO[modo]