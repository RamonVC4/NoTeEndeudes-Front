import {
  CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { mxn, mxnCorto } from '../lib/formato'
import type { Flujo30d } from '../lib/ui-tipos'

interface Props {
  flujo: Flujo30d
  /** Color del valle: sale del componente de flujo que devuelve el backend. */
  colorValle: string
}

/**
 * Los 30 días proyectados. El valle es el momento en que el usuario entiende
 * el producto, así que va marcado con punto y etiqueta.
 */
export default function GraficaFlujo({ flujo, colorValle }: Props) {
  const datos = flujo.serie.map((saldo, i) => ({ dia: i + 1, saldo }))
  const hayValle = flujo.dia_minimo >= 1
  const bajoCero = flujo.minimo < 0

  // Holgura abajo para que la etiqueta del valle no pise la línea ni se corte.
  const min = Math.min(...flujo.serie)
  const max = Math.max(...flujo.serie)
  const rango = max - min || Math.abs(max) || 1
  const dominio: [number, number] = [min - rango * 0.22, max + rango * 0.06]

  return (
    <div className="h-[220px] -ml-2" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={datos} margin={{ top: 24, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="var(--linea)" vertical={false} />
          <XAxis
            dataKey="dia"
            ticks={[1, 5, 10, 15, 20, 25, 30]}
            tickLine={false}
            axisLine={{ stroke: 'var(--linea)' }}
            tick={{ fill: 'var(--tinta-suave)', fontSize: 12 }}
          />
          <YAxis
            width={52}
            domain={dominio}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--tinta-suave)', fontSize: 12 }}
            tickFormatter={mxnCorto}
          />
          <Tooltip
            cursor={{ stroke: 'var(--linea)' }}
            contentStyle={{
              background: 'var(--superficie)',
              border: '1px solid var(--linea)',
              borderRadius: 6,
              fontSize: 13,
            }}
            labelFormatter={(d) => `Día ${d}`}
            formatter={(v: number) => [mxn(v), 'Saldo']}
          />
          {bajoCero && <ReferenceLine y={0} stroke="var(--rojo)" strokeDasharray="3 3" />}
          <Line
            type="monotone"
            dataKey="saldo"
            stroke="var(--tinta)"
            strokeWidth={1.75}
            dot={false}
            activeDot={{ r: 3, fill: 'var(--tinta)' }}
            isAnimationActive={false}
          />
          {hayValle && (
            <ReferenceDot
              x={flujo.dia_minimo}
              y={flujo.minimo}
              r={5}
              fill={colorValle}
              stroke="var(--superficie)"
              strokeWidth={2}
              label={{
                value: `${mxn(flujo.minimo)} el día ${flujo.dia_minimo}`,
                position: 'bottom',
                offset: 9,
                fill: colorValle,
                fontSize: 12,
                fontWeight: 600,
              }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}