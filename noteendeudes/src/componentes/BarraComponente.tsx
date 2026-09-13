import { bandaDeScore, colorBanda, EXPLICA_COMPONENTE, NOMBRE_COMPONENTE } from '../lib/formato'
import type { Componente } from '../lib/tipos'

interface Props {
  componente: Componente
  valor: number
  peso: number
  /** Valor anterior: se pinta el rastro del movimiento tras registrar un gasto. */
  anterior?: number | null
  destacar?: boolean
}

/**
 * Cada componente con su peso: es lo que hace explicable el número.
 * El color sale de la misma tabla de bandas del backend aplicada al 0-100
 * del componente; ningún componente elige color por su cuenta.
 */
export default function BarraComponente({
  componente, valor, peso, anterior = null, destacar = false,
}: Props) {
  const color = colorBanda(bandaDeScore(valor).color)
  const hubo = anterior !== null && anterior !== valor
  const bajo = hubo && valor < anterior!

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-14">{NOMBRE_COMPONENTE[componente]}</span>
        <span className="cifra text-14 tabular-nums">
          {hubo && (
            <span className="text-tinta-suave line-through mr-1.5">{anterior}</span>
          )}
          <span style={hubo ? { color } : undefined}>{valor}</span>
          <span className="text-tinta-suave"> / 100</span>
        </span>
      </div>

      <div
        className={`h-1.5 rounded-full mt-1.5 overflow-hidden ${destacar ? 'pulso-componente' : ''}`}
        style={{ background: 'var(--linea)' }}
        role="img"
        aria-label={`${NOMBRE_COMPONENTE[componente]}: ${valor} de 100, pesa ${peso}% del score`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${valor}%`, background: color }}
        />
      </div>

      <div className="flex items-baseline justify-between gap-3 mt-1">
        <p className="text-12 text-tinta-suave">
          {hubo
            ? <span style={{ color }}>
                {bajo ? 'Bajó' : 'Subió'} {Math.abs(valor - anterior!)} con este movimiento
              </span>
            : EXPLICA_COMPONENTE[componente]}
        </p>
        <p className="text-12 text-tinta-suave shrink-0 cifra">{peso}% del score</p>
      </div>
    </div>
  )
}