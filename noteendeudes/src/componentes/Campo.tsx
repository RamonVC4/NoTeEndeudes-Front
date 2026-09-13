import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

interface Base {
  etiqueta: string
  error?: string | null
  ayuda?: ReactNode
  /** Lo llenó la extracción del PDF: borde en --accion y rótulo. */
  deIA?: boolean
}

interface PropsCampo extends Base, Omit<InputHTMLAttributes<HTMLInputElement>, 'children'> {
  prefijo?: string
  sufijo?: string
  /** Un control al final del campo, como el botón para ver la contraseña. */
  accion?: ReactNode
}

/**
 * El id de la nota de abajo, o undefined si no hay nota.
 *
 * Sin esto el mensaje de error existe solo visualmente: el borde rojo y el
 * texto no llegan a un lector de pantalla, que anuncia el campo como inválido
 * sin poder decir por qué. `aria-describedby` es lo que los une.
 */
const idNotaDe = (id: string, error?: string | null, ayuda?: ReactNode) =>
  error || ayuda ? `${id}-nota` : undefined

function Envoltura({
  id, etiqueta, error, ayuda, deIA, children,
}: Base & { id: string; children: ReactNode }) {
  const idNota = idNotaDe(id, error, ayuda)
  return (
    <div>
      <label htmlFor={id} className="etiqueta flex items-center gap-2">
        <span>{etiqueta}</span>
        {deIA && (
          <span className="text-12 text-accion border border-accion/40 rounded px-1 leading-tight">
            de tu PDF
          </span>
        )}
      </label>
      {children}
      {error
        ? <p id={idNota} className="text-12 mt-1" style={{ color: 'var(--rojo)' }}>{error}</p>
        : ayuda
          ? <p id={idNota} className="text-12 text-tinta-suave mt-1">{ayuda}</p>
          : null}
    </div>
  )
}

export default function Campo({
  etiqueta, error, ayuda, deIA, prefijo, sufijo, accion, className = '', id, ...resto
}: PropsCampo) {
  const auto = useId()
  const idCampo = id ?? auto
  const borde = error
    ? { borderColor: 'var(--rojo)' }
    : deIA
      ? { borderColor: 'var(--accion)' }
      : undefined

  return (
    <Envoltura id={idCampo} etiqueta={etiqueta} error={error} ayuda={ayuda} deIA={deIA}>
      <div className="relative">
        {prefijo && (
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tinta-suave pointer-events-none">
            {prefijo}
          </span>
        )}
        <input
          {...resto}
          id={idCampo}
          aria-invalid={error ? true : undefined}
          aria-describedby={idNotaDe(idCampo, error, ayuda)}
          style={borde}
          className={[
            'control cifra',
            prefijo ? 'pl-6' : '',
            sufijo ? 'pr-8' : '',
            accion ? 'pr-10' : '',
            className,
          ].join(' ')}
        />
        {sufijo && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-tinta-suave pointer-events-none">
            {sufijo}
          </span>
        )}
        {accion && (
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex">
            {accion}
          </div>
        )}
      </div>
    </Envoltura>
  )
}

interface PropsSelect extends Base, SelectHTMLAttributes<HTMLSelectElement> {}

export function CampoSelect({
  etiqueta, error, ayuda, deIA, className = '', id, children, ...resto
}: PropsSelect) {
  const auto = useId()
  const idCampo = id ?? auto
  return (
    <Envoltura id={idCampo} etiqueta={etiqueta} error={error} ayuda={ayuda} deIA={deIA}>
      <select
        {...resto}
        id={idCampo}
        aria-invalid={error ? true : undefined}
        aria-describedby={idNotaDe(idCampo, error, ayuda)}
        style={error ? { borderColor: 'var(--rojo)' } : undefined}
        className={`control ${className}`}
      >
        {children}
      </select>
    </Envoltura>
  )
}

interface PropsCheck extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> {
  etiqueta: string
  ayuda?: ReactNode
}

/**
 * Casilla con su explicación al lado. La usa `es_variable`, donde marcarla no
 * cambia un dato sino el comportamiento de la app: al confirmar ese gasto se
 * pedirá el monto real.
 */
export function CampoCheck({ etiqueta, ayuda, id, className = '', ...resto }: PropsCheck) {
  const auto = useId()
  const idCampo = id ?? auto
  const idNota = ayuda ? `${idCampo}-nota` : undefined
  return (
    <div className="flex gap-2.5 items-start">
      <input
        {...resto}
        type="checkbox"
        id={idCampo}
        aria-describedby={idNota}
        className={`mt-0.5 size-4 shrink-0 accent-[var(--accion)] ${className}`}
      />
      <div className="min-w-0">
        <label htmlFor={idCampo} className="text-14 block">{etiqueta}</label>
        {ayuda && <p id={idNota} className="text-12 text-tinta-suave mt-0.5">{ayuda}</p>}
      </div>
    </div>
  )
}