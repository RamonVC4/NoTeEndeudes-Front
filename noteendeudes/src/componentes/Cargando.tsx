/**
 * Skeletons, no spinners: la pantalla se dibuja con la forma que va a tener y
 * se rellena. El usuario no ve un hueco girando.
 */
interface Props {
  className?: string
}

export default function Cargando({ className = 'h-4 w-full' }: Props) {
  return (
    <div
      aria-hidden
      className={`rounded animate-pulse ${className}`}
      style={{ background: 'color-mix(in srgb, var(--linea) 70%, transparent)' }}
    />
  )
}

export function CargandoPanel({ lineas = 3 }: { lineas?: number }) {
  return (
    <div className="panel p-4 space-y-3" role="status" aria-label="Cargando">
      <Cargando className="h-4 w-1/3" />
      {Array.from({ length: lineas }).map((_, i) => (
        <Cargando key={i} className="h-3 w-full" />
      ))}
    </div>
  )
}
