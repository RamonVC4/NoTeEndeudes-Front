/**
 * `Idempotency-Key` — una clave POR GESTO DEL USUARIO, no por petición.
 *
 * Todo endpoint que mueve dinero acepta la cabecera. La regla que importa está
 * en API.md §2: cuando el usuario toca "guardar" se genera un UUID y se reusa
 * en TODOS los reintentos de ese gesto. Si se generara uno nuevo en cada
 * reintento, un timeout de la librería HTTP registraría el gasto dos veces y
 * bajaría el saldo dos veces.
 *
 * Si la clave ya se usó, el servidor responde 200 con `repetido: true` y el
 * movimiento que ya existía. No es un error y el saldo no se mueve otra vez.
 */
import { useCallback, useRef } from 'react'

export function nuevaClave(): string {
  // randomUUID existe en todo contexto seguro, y localhost lo es. El respaldo
  // es para un http:// plano en la red local durante la demo.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * La clave vive mientras dure el gesto.
 *
 *     const { clave, gestoCompletado } = useClaveIdempotencia()
 *     await api.registrarMovimiento(cuerpo, clave())   // reintentos: misma clave
 *     gestoCompletado()                                // el siguiente es otro gesto
 */
export function useClaveIdempotencia() {
  const actual = useRef<string | null>(null)

  const clave = useCallback(() => {
    if (actual.current === null) actual.current = nuevaClave()
    return actual.current
  }, [])

  /** Tras un envío exitoso: lo que venga después es un gesto distinto. */
  const gestoCompletado = useCallback(() => { actual.current = null }, [])

  return { clave, gestoCompletado }
}