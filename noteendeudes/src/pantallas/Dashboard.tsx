import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as api from '../lib/api'
import { usarDatos } from '../lib/usarDatos'
import {
  bandaDeScore, colorBanda, fecha, mxn, pctYa,
} from '../lib/formato'
import type {
  Componente, Estado, PagoPendiente, PendientesResponse, ScoreResponse, TarjetaEstado,
} from '../lib/tipos'
import Encabezado from '../componentes/Encabezado'
import BarraComponente from '../componentes/BarraComponente'
import GraficaFlujo from '../componentes/GraficaFlujo'
import Cargando, { CargandoPanel } from '../componentes/Cargando'
import ErrorApi from '../componentes/ErrorApi'
import Vacio from '../componentes/Vacio'
import Boton from '../componentes/Boton'

const ORDEN: Componente[] = ['liquidez', 'deuda', 'utilizacion', 'flujo']

export default function Dashboard() {
  // Inicio = score + lo que toca confirmar + los cortes por cubrir. Las dos
  // ultimas no tumban la pantalla si fallan: son avisos, no el contenido.
  const cargar = useCallback(
    () => Promise.all([
      api.score(),
      api.estado(),
      api.pendientes().catch(() => null),
      api.pagosPendientes().then(r => r.data).catch(() => []),
    ]),
    [],
  )
  const { datos, error, cargando, recargar } = usarDatos(cargar)

  if (cargando && !datos) return <Esqueleto />
  if (!datos) {
    return (
      <>
        <Encabezado titulo="Resumen" />
        <ErrorApi error={error} reintentar={recargar} />
      </>
    )
  }

  const [score, estado, pendientes, cortes] = datos
  return (
    <Contenido
      score={score}
      estado={estado}
      pendientes={pendientes}
      cortes={cortes}
    />
  )
}

function Contenido({
  score, estado, pendientes, cortes,
}: {
  score: ScoreResponse
  estado: Estado
  pendientes: PendientesResponse | null
  cortes: PagoPendiente[]
}) {
  const color = colorBanda(score.color)
  const colorFlujo = colorBanda(bandaDeScore(score.componentes.flujo).color)

  return (
    <>
      <Encabezado titulo="Resumen" />

      <AvisoCortes cortes={cortes} />
      <AvisoPendientes pendientes={pendientes} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="panel p-5" aria-labelledby="titulo-score">
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <p id="titulo-score" className="text-12 text-tinta-suave">
                Salud financiera
              </p>
              <ScoreAnimado valor={score.score} color={color} />
            </div>
            <div className="pb-2">
              <p className="text-16 font-medium" style={{ color }}>{score.banda}</p>
              <p className="text-12 text-tinta-suave">de 100 puntos</p>
            </div>
          </div>

          <div className="border-t border-linea mt-5 pt-5 space-y-4">
            {ORDEN.map(k => (
              <BarraComponente
                key={k}
                componente={k}
                valor={score.componentes[k]}
                peso={score.pesos[k]}
              />
            ))}
          </div>
        </section>

        <section className="panel p-5 space-y-4" aria-label="Cifras del mes">
          <Dato etiqueta="Dinero disponible hoy" valor={mxn(estado.liquidez)} destacado />
          <Dato etiqueta="Sale al mes" valor={mxn(score.gasto_mensual_total)} />
          <Dato
            etiqueta="Pagos comprometidos"
            valor={mxn(score.obligaciones_mensuales)}
            nota="Mínimos de tarjetas y mensualidades a MSI"
          />
          <Dato
            etiqueta="Intereses al mes"
            valor={mxn(score.intereses_mensuales)}
            nota={score.intereses_mensuales > 0
              ? 'Lo que cuesta traer saldo revolvente'
              : 'No traes saldo revolvente'}
            alerta={score.intereses_mensuales > 0}
          />
        </section>
      </div>

      <section className="panel p-5 mt-4" aria-labelledby="titulo-flujo">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 id="titulo-flujo" className="font-titulo text-16">Tus próximos 30 días</h2>
          <p className="text-12 text-tinta-suave">
            {score.flujo_30d.dia_minimo >= 1
              ? 'El punto marca el día en que menos dinero vas a tener'
              : 'Tu saldo no baja del que tienes hoy'}
          </p>
        </div>

        <GraficaFlujo flujo={score.flujo_30d} colorValle={colorFlujo} />

        {score.flujo_30d.dia_minimo >= 1 && (
          <p className="text-14 mt-1">
            El día {score.flujo_30d.dia_minimo} te quedan{' '}
            <span className="cifra font-medium" style={{ color: colorFlujo }}>
              {mxn(score.flujo_30d.minimo)}
            </span>
            {score.flujo_30d.minimo < 0 && ' — ese día no te alcanza'}
          </p>
        )}
      </section>

      <section className="mt-4" aria-labelledby="titulo-tarjetas">
        <h2 id="titulo-tarjetas" className="font-titulo text-16 mb-2">Tus tarjetas</h2>
        {estado.tarjetas.length === 0 ? (
          <Vacio
            titulo="Aún no tienes tarjetas de crédito con términos"
            detalle="Captura límite, saldo y tasa para que entren al cálculo."
            accion={<Link to="/tarjetas"><Boton tono="primario">Agregar tarjeta</Boton></Link>}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {estado.tarjetas.map(t => <TarjetaResumenCard key={t.id} tarjeta={t} />)}
          </div>
        )}
      </section>
    </>
  )
}

/** Conteo del score al cargar: 600 ms, respetando prefers-reduced-motion. */
function ScoreAnimado({ valor, color }: { valor: number; color: string }) {
  const [n, setN] = useState(valor)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setN(valor)
      return
    }
    let raf = 0
    const inicio = performance.now()
    const paso = (t: number) => {
      const p = Math.min(1, (t - inicio) / 600)
      setN(Math.round(valor * (1 - (1 - p) ** 3)))
      if (p < 1) raf = requestAnimationFrame(paso)
    }
    setN(0)
    raf = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(raf)
  }, [valor])

  return (
    <p
      className="cifra font-titulo text-56 font-semibold leading-none"
      style={{ color }}
      aria-label={`Score ${valor} de 100`}
    >
      {n}
    </p>
  )
}

/**
 * La frase mas util de la app.
 *
 * En credito mexicano lo que determina si pagas intereses no es el saldo de
 * hoy: es el saldo al corte. `falta_para_no_intereses` y `dias_restantes`
 * vienen calculados; aqui solo se pintan.
 */
function AvisoCortes({ cortes }: { cortes: PagoPendiente[] }) {
  const pendientes = cortes.filter(c => c.falta_para_no_intereses > 0)
  if (pendientes.length === 0) return null

  return (
    <section className="space-y-2 mb-4" aria-label="Cortes por cubrir">
      {pendientes.map(c => {
        // El color sale de los dias que quedan, que los dice el backend.
        const urgente = c.dias_restantes <= 3
        const color = urgente ? 'var(--rojo)' : 'var(--ambar)'
        return (
          <div key={c.tarjeta_id} className="panel p-4" style={{ borderColor: color }}>
            <p className="text-14">
              Tu corte de <span className="font-medium">{c.tarjeta}</span> fue el{' '}
              {fecha(c.fecha_corte)}. Paga{' '}
              <span className="cifra font-medium" style={{ color }}>
                {mxn(c.falta_para_no_intereses)}
              </span>{' '}
              antes del {fecha(c.fecha_limite_pago)} y no generas intereses.
            </p>
            <p className="text-12 text-tinta-suave mt-1">
              {c.dias_restantes > 0
                ? `Te quedan ${c.dias_restantes} día${c.dias_restantes === 1 ? '' : 's'}.`
                : 'Ya venció el plazo.'}
              {' '}El mínimo para no caer en mora son {mxn(c.falta_para_no_mora)}.
            </p>
            <Link to="/movimientos" className="inline-block mt-2">
              <Boton tono="secundario">Registrar el pago</Boton>
            </Link>
          </div>
        )
      })}
    </section>
  )
}

/** Lo que toca y aun no se confirma. El detalle vive en /confirmar. */
function AvisoPendientes({ pendientes }: { pendientes: PendientesResponse | null }) {
  if (!pendientes) return null
  const cuantos = pendientes.ingresos.length + pendientes.gastos.length
  if (cuantos === 0) return null

  return (
    <section className="panel p-4 mb-4 flex items-center gap-3 flex-wrap">
      <div className="min-w-0 flex-1">
        <p className="text-14">
          Tienes {cuantos} movimiento{cuantos === 1 ? '' : 's'} por confirmar.
        </p>
        <p className="text-12 text-tinta-suave cifra mt-0.5">
          {mxn(pendientes.total_por_cobrar)} por cobrar ·{' '}
          {mxn(pendientes.total_por_pagar)} por pagar
        </p>
      </div>
      <Link to="/confirmar">
        <Boton tono="secundario">Ver cuáles</Boton>
      </Link>
    </section>
  )
}

function Dato({
  etiqueta, valor, nota, destacado = false, alerta = false,
}: {
  etiqueta: string; valor: string; nota?: string; destacado?: boolean; alerta?: boolean
}) {
  return (
    <div>
      <p className="text-12 text-tinta-suave">{etiqueta}</p>
      <p
        className={`cifra ${destacado ? 'text-32 font-titulo font-semibold' : 'text-20 font-medium'}`}
        style={alerta ? { color: 'var(--naranja)' } : undefined}
      >
        {valor}
      </p>
      {nota && <p className="text-12 text-tinta-suave mt-0.5">{nota}</p>}
    </div>
  )
}

function TarjetaResumenCard({ tarjeta }: { tarjeta: TarjetaEstado }) {
  const utilizacion = tarjeta.limite > 0 ? (tarjeta.saldo / tarjeta.limite) * 100 : 0
  // La utilización usa la escala del backend al revés: 30% o menos es sano.
  const color = colorBanda(bandaDeScore(Math.max(0, 100 - (utilizacion - 30) * 2)).color)

  return (
    <article className="panel p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-14 font-medium truncate">{tarjeta.nombre}</h3>
        <span className="cifra text-12 text-tinta-suave">{pctYa(utilizacion)} usado</span>
      </div>

      <div className="h-1 rounded-full mt-2 overflow-hidden" style={{ background: 'var(--linea)' }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, utilizacion)}%`, background: color }}
        />
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 mt-3">
        <dt className="text-12 text-tinta-suave">Debes</dt>
        <dt className="text-12 text-tinta-suave text-right">Puedes usar</dt>
        <dd className="cifra text-16 font-medium">{mxn(tarjeta.saldo)}</dd>
        <dd className="cifra text-16 font-medium text-right">{mxn(tarjeta.disponible)}</dd>
      </dl>
    </article>
  )
}

function Esqueleto() {
  return (
    <>
      <Encabezado titulo="Resumen" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="panel p-5 space-y-4">
          <Cargando className="h-14 w-32" />
          {[0, 1, 2, 3].map(i => <Cargando key={i} className="h-8 w-full" />)}
        </div>
        <CargandoPanel lineas={4} />
      </div>
      <div className="panel p-5 mt-4"><Cargando className="h-[220px] w-full" /></div>
    </>
  )
}
