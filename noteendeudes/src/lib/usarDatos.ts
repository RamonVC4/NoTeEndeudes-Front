import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * El patrón de carga que repiten las cinco pantallas: pide, guarda, expone
 * error y permite reintentar. No es una librería de fetching, son 25 líneas
 * que se escribirían igual cinco veces.
 */
export function usarDatos<T>(cargar: () => Promise<T>) {
  const [datos, setDatos] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [cargando, setCargando] = useState(true)
  const [intento, setIntento] = useState(0)

  // La función llega inline desde la pantalla: cambia de identidad en cada
  // render, así que se guarda en un ref y el efecto depende solo del intento.
  const ref = useRef(cargar)
  ref.current = cargar

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError(null)
    // Los datos anteriores se conservan durante un refresco: la pantalla no
    // parpadea y lo que esté abierto encima no se desmonta.
    ref.current()
      .then(d => { if (vivo) setDatos(d) })
      .catch(e => { if (vivo) setError(e) })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [intento])

  const recargar = useCallback(() => setIntento(n => n + 1), [])

  return { datos, error, cargando, recargar, setDatos }
}