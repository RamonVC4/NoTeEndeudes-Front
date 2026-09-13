import type { ReactNode } from 'react'
import FechaHoy from './FechaHoy'

/**
 * Encabezado de pantalla: título, fecha de hoy y, si hace falta, la acción
 * principal. Único lugar donde se decide cómo se ve el `<h1>` de una pantalla.
 *
 * En md+ la fecha va en la misma fila del título, separada por un filete; abajo
 * de md baja a su propia línea (`w-full order-last`) porque no cabe al lado de
 * títulos como "¿Me conviene comprar esto?". La acción se queda pegada a la
 * derecha en los dos casos.
 */
export default function Encabezado({
  titulo, accion,
}: { titulo: string; accion?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-4">
      <h1 className="font-titulo text-20 min-w-0">{titulo}</h1>

      {/* h-[1.625rem] = alto de línea del h1 (text-20 × 1.3). Fijo a propósito:
          con `self-stretch` el filete se estiraba al alto del botón de acción y
          sobresalía del título en Tarjetas y Gastos fijos. */}
      <FechaHoy
        className="order-last w-full
                   md:order-none md:w-auto md:h-[1.625rem] md:flex md:items-center
                   md:border-l md:border-linea md:pl-3"
      />

      {accion && <div className="ml-auto shrink-0">{accion}</div>}
    </div>
  )
}