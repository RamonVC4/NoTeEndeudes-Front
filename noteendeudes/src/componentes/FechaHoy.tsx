import { useEffect, useState } from 'react'
import { fechaLarga, hoyISO } from '../lib/formato'

/**
 * La fecha de hoy, en el encabezado de cada pantalla. El copy de la app se
 * apoya todo el tiempo en el calendario ("te quedan 3 días", "día 15 de cada
 * mes", cortes de tarjeta): sin saber en qué día está parado, el usuario no
 * puede leer esas cifras.
 *
 * El `className` lo manda quien lo monta; este componente no decide dónde va.
 */
export default function FechaHoy({ className = '' }: { className?: string }) {
  const iso = useHoy()

  return (
    <time dateTime={iso} className={`text-12 text-tinta-suave cifra ${className}`}>
      {fechaLarga(iso)}
    </time>
  )
}

/**
 * Se repinta al cruzar la medianoche. Una sesión que se queda abierta de noche
 * mostraría la fecha de ayer, y aquí eso no es cosmético: contradice los avisos
 * de días restantes que pinta el Resumen.
 */
function useHoy(): string {
  const [iso, setIso] = useState(hoyISO)

  useEffect(() => {
    const manana = new Date()
    manana.setHours(24, 0, 0, 0)
    // +1s de colchón: sin él el timer puede dispararse un pelo antes y `hoyISO()`
    // devolvería todavía la fecha de ayer.
    const falta = manana.getTime() - Date.now() + 1000
    const t = window.setTimeout(() => setIso(hoyISO()), falta)
    return () => window.clearTimeout(t)
  }, [iso])

  return iso
}