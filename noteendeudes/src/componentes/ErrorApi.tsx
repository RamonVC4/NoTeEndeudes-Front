import { TriangleAlert } from 'lucide-react'
import { ApiException } from '../lib/api'
import Boton from './Boton'

interface Props {
  error: unknown
  reintentar?: () => void
}

/**
 * Los mensajes de regla_de_negocio y conflicto vienen redactados para el
 * usuario: se pintan tal cual, palabra por palabra. No se reescriben.
 */
export default function ErrorApi({ error, reintentar }: Props) {
  if (!error) return null

  const api = error instanceof ApiException ? error : null
  const mensaje = api
    ? api.mensaje
    : error instanceof Error
      ? error.message
      : 'Ocurrió un error inesperado'

  const validas = api?.detalle?.validas ?? []

  return (
    <div
      role="alert"
      className="panel p-4 flex gap-3 items-start"
      style={{ borderColor: 'var(--rojo)' }}
    >
      <TriangleAlert size={18} style={{ color: 'var(--rojo)' }} className="shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-14">{mensaje}</p>
        {api?.codigo === 'validacion' && api.campos.length > 0 && (
          <ul className="text-12 text-tinta-suave mt-1 list-disc pl-4">
            {api.detalle.campos?.map(c => (
              <li key={c.campo}>{c.campo}: {c.error}</li>
            ))}
          </ul>
        )}
        {/* Una categoria invalida vuelve con la lista de las validas: se
            muestran en vez de dejar al usuario adivinando cual acepta. */}
        {validas.length > 0 && (
          <p className="text-12 text-tinta-suave mt-1">
            Validas: {validas.join(', ')}
          </p>
        )}
        {reintentar && (
          <Boton tono="secundario" className="mt-3" onClick={reintentar}>
            Reintentar
          </Boton>
        )}
      </div>
    </div>
  )
}

/** Versión de una línea, para errores dentro de un formulario. */
export function ErrorLinea({ error }: { error: unknown }) {
  if (!error) return null
  const mensaje = error instanceof ApiException
    ? error.mensaje
    : error instanceof Error ? error.message : String(error)
  return (
    <p role="alert" className="text-14 flex items-start gap-2" style={{ color: 'var(--rojo)' }}>
      <TriangleAlert size={16} className="shrink-0 mt-0.5" />
      <span>{mensaje}</span>
    </p>
  )
}

/** Los campos que marcó un 422 de validación, para pintarlos en el formulario. */
export function camposConError(error: unknown): Record<string, string> {
  if (!(error instanceof ApiException) || error.codigo !== 'validacion') return {}
  return Object.fromEntries((error.detalle.campos ?? []).map(c => [c.campo, c.error]))
}