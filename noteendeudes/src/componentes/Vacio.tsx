import type { ReactNode } from 'react'

interface Props {
  titulo: string
  detalle?: string
  accion?: ReactNode
  icono?: ReactNode
}

/** Estado vacío con salida: nunca se deja al usuario mirando la nada. */
export default function Vacio({ titulo, detalle, accion, icono }: Props) {
  return (
    <div className="panel p-8 text-center">
      {icono && <div className="text-tinta-suave flex justify-center mb-3">{icono}</div>}
      <p className="text-16 font-medium">{titulo}</p>
      {detalle && <p className="text-14 text-tinta-suave mt-1 max-w-md mx-auto">{detalle}</p>}
      {accion && <div className="mt-4 flex justify-center">{accion}</div>}
    </div>
  )
}