import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import * as api from '../lib/api'
import { usarDatos } from '../lib/usarDatos'
import { explicarPrioridad } from '../lib/ia'
import type { ExplicacionDeudaResponse } from '../lib/ia'
import { colorBanda, fecha, mxn, pct, pctYa } from '../lib/formato'
import type {
  DeudaRanking, DeudaResponse, MedioSalida, PagoPendiente, PagoResponse,
  TarjetaResumen,
} from '../lib/tipos'
import { ETIQUETA_PAGO, etiquetaEnFicha, modoDe } from '../lib/pagoTarjeta'
import Encabezado from '../componentes/Encabezado'
import Boton from '../componentes/Boton'
import Cargando, { CargandoPanel } from '../componentes/Cargando'
import ErrorApi, { ErrorLinea } from '../componentes/ErrorApi'
import Modal from '../componentes/Modal'
import { CampoSelect } from '../componentes/Campo'
import { useClaveIdempotencia } from '../lib/idempotencia'
import Vacio from '../componentes/Vacio'

export default function Deuda() {
  // Tres llamadas en paralelo, mismo patrón que Dashboard: solo el ranking es el
  // contenido de la pantalla. Las otras dos son contexto — si fallan, el ranking
  // se pinta igual y lo único que se degrada es el monto sugerido. Por eso los
  // `.catch`.
  //
  // `/tarjetas` está aquí por UN dato que no se deriva de nada: `pago_minimo`.
  // No viene en `DeudaRanking` y es la segunda fuente del próximo pago cuando la
  // tarjeta no tiene un corte cerrado. (No se usa para cruzar por nombre, que era
  // lo que rompía con tarjetas homónimas: el cruce va por `tarjeta_id`.)
  const cargar = useCallback(
    () => Promise.all([
      api.prioridad(),
      api.pagosPendientes().then(r => r.data).catch(() => [] as PagoPendiente[]),
      api.tarjetas().then(r => r.data).catch(() => [] as TarjetaResumen[]),
    ]),
    [],
  )
  const { datos, error, cargando, recargar } = usarDatos(cargar)

  // Solo se desmonta el contenido en la primera carga. Al refrescar tras un
  // pago se conservan los datos viejos y, con ellos, el modal del recibo.
  if (cargando && !datos) {
    return (
      <>
        <Titulo />
        <div className="space-y-3">
          <CargandoPanel lineas={3} />
          <CargandoPanel lineas={3} />
        </div>
      </>
    )
  }
  if (!datos) {
    return <><Titulo /><ErrorApi error={error} reintentar={recargar} /></>
  }

  const [deuda, cortes, tarjetas] = datos
  return (
    <Contenido deuda={deuda} cortes={cortes} tarjetas={tarjetas} alPagar={recargar} />
  )
}

const Titulo = () => <Encabezado titulo="¿Qué pago primero?" />

// ---------------------------------------------------------- próximo pago
/**
 * EL PAGO QUE TOCA, que casi nunca es la deuda completa.
 *
 * El saldo de una tarjeta y el pago que sigue son dos números distintos, y
 * sugerir el primero cuando el usuario pregunta por el segundo es el error que
 * esta pantalla existe para evitar. El monto sale de una escalera de fuentes,
 * de la más confiable a la menos:
 *
 *   1. El corte cerrado (`falta_para_no_intereses`). Es el único origen que
 *      trae FECHA LÍMITE, y por eso es el único que puede prometer que la tasa
 *      no corre si pagas a tiempo.
 *   2. El pago capturado de la tarjeta (`pago_minimo`). El backend guarda UN
 *      solo número por tarjeta y `pagoTarjeta.ts` recuerda en localStorage cuál
 *      de los dos capturó el usuario. Cuando el modo es `total`, ese número ES
 *      el pago para no generar intereses — pero sin fecha, porque no hay corte.
 *   3. Nada. Se devuelve `null` y la pantalla lo dice en vez de inventar una
 *      cifra: mejor un campo vacío que un número que no significa nada.
 *
 * `evitaIntereses` separa (1) y (2)-en-modo-total del resto. Es la diferencia
 * entre "paga esto y no te cobran" y "paga esto y te cobran menos", y ninguna
 * etiqueta debería confundirlas.
 */
type OrigenPago = 'corte' | 'capturado_total' | 'capturado_minimo' | 'capturado_incierto'

interface ProximoPago {
  origen: OrigenPago
  monto: number
  etiqueta: string
  ayuda: string
  evitaIntereses: boolean
  /** ISO. Solo con corte: es el único origen fechado. */
  limite: string | null
}

function proximoPagoDe(
  deuda: DeudaRanking,
  corte: PagoPendiente | null,
  tarjeta: TarjetaResumen | undefined,
): ProximoPago | null {
  // El clamp contra el saldo se repite en los dos caminos: el `max` del input es
  // el saldo, y un monto sugerido por encima dejaría el formulario inválido al
  // nacer. Pasa de verdad — `falta_para_no_intereses` sale de un corte cerrado y
  // el saldo pudo bajar después por otra vía.
  if (corte && corte.falta_para_no_intereses > 0) {
    return {
      origen: 'corte',
      monto: Math.min(corte.falta_para_no_intereses, deuda.saldo),
      etiqueta: 'Para no generar intereses',
      ayuda: `Cubre todo lo de tu corte del ${fecha(corte.fecha_corte)}. Pagando esto antes del ${fecha(corte.fecha_limite_pago)}, la tasa no corre.`,
      evitaIntereses: true,
      limite: corte.fecha_limite_pago,
    }
  }

  const capturado = tarjeta?.pago_minimo ?? 0
  if (capturado <= 0) return null

  const monto = Math.min(capturado, deuda.saldo)
  const modo = modoDe(deuda.tarjeta_id)

  if (modo === 'total') {
    return {
      origen: 'capturado_total',
      monto,
      etiqueta: ETIQUETA_PAGO.total,
      ayuda: 'Es el número que capturaste de tu estado de cuenta. Cierra tu corte para que además te digamos hasta qué día tienes.',
      evitaIntereses: true,
      limite: null,
    }
  }

  if (modo === 'minimo') {
    return {
      origen: 'capturado_minimo',
      monto,
      etiqueta: ETIQUETA_PAGO.minimo,
      ayuda: 'Es lo más chico que te acepta el banco: te salva de la mora, pero los intereses te los cobran igual.',
      evitaIntereses: false,
      limite: null,
    }
  }

  // El modo vive en localStorage, así que falta en otro navegador u otro
  // dispositivo. No se asume ninguno de los dos: son cantidades muy distintas y
  // adivinar mal es peor que decir que no se sabe.
  return {
    origen: 'capturado_incierto',
    monto,
    etiqueta: etiquetaEnFicha(null),
    ayuda: 'Es el pago que capturaste en esta tarjeta, pero no sabemos si es el mínimo o el que evita intereses. Dilo en Tarjetas y te lo afinamos.',
    evitaIntereses: false,
    limite: null,
  }
}

function Contenido({
  deuda, cortes, tarjetas, alPagar,
}: {
  deuda: DeudaResponse
  cortes: PagoPendiente[]
  tarjetas: TarjetaResumen[]
  alPagar: () => void
}) {
  const [pagando, setPagando] = useState<DeudaRanking | null>(null)
  const [recibo, setRecibo] = useState<PagoResponse | null>(null)

  // Derivados en el render. Son un puñado de elementos: memorizarlos costaría
  // más que rehacerlos. El próximo pago se resuelve UNA vez aquí y baja ya
  // resuelto a la fila y al modal, para que los dos muestren el mismo número.
  const cortePorTarjeta = new Map(cortes.map(c => [c.tarjeta_id, c]))
  const tarjetaPorId = new Map(tarjetas.map(t => [t.id, t]))
  const proximoDe = (r: DeudaRanking) =>
    proximoPagoDe(r, cortePorTarjeta.get(r.tarjeta_id) ?? null, tarjetaPorId.get(r.tarjeta_id))

  if (deuda.ranking.length === 0) {
    return (
      <>
        <Titulo />
        <Vacio
          titulo="No debes nada en tus tarjetas"
          detalle="Cuando traigas saldo, aquí aparece cuál conviene pagar primero y por qué."
          accion={<Link to="/tarjetas"><Boton tono="secundario">Ver tus tarjetas</Boton></Link>}
        />
      </>
    )
  }

  return (
    <>
      <Titulo />

      <CostoMensual intereses={deuda.intereses_totales_mes} />

      <ExplicacionIA deuda={deuda} />

      <h2 className="font-titulo text-16 mt-5 mb-2">En este orden</h2>
      <div className="space-y-3">
        {deuda.ranking.map((r, i) => (
          <FilaDeuda
            key={r.tarjeta_id}
            posicion={i + 1}
            deuda={r}
            corte={cortePorTarjeta.get(r.tarjeta_id) ?? null}
            proximo={proximoDe(r)}
            puedePagar
            onPagar={() => setPagando(r)}
          />
        ))}
      </div>

      {pagando && (
        <ModalPago
          deuda={pagando}
          corte={cortePorTarjeta.get(pagando.tarjeta_id) ?? null}
          proximo={proximoDe(pagando)}
          onCerrar={() => setPagando(null)}
          onHecho={r => { setPagando(null); setRecibo(r); alPagar() }}
        />
      )}

      {recibo && (
        <ModalRecibo recibo={recibo} onCerrar={() => setRecibo(null)} />
      )}
    </>
  )
}

// -------------------------------------------------------- costo mensual
/**
 * El número grande, en CONDICIONAL.
 *
 * `intereses_totales_mes` no es un cargo que ya ocurrió ni dinero que salió de
 * la cuenta: es lo que el banco va a cobrar si el saldo sigue ahí un mes más.
 * La redacción anterior ("tus tarjetas te cuestan al mes") lo afirmaba en
 * presente indicativo y se leía como una factura ya pagada.
 */
function CostoMensual({ intereses }: { intereses: number }) {
  if (intereses <= 0) {
    return (
      <section className="panel p-5" aria-label="Costo mensual de tu deuda">
        <p className="text-14 text-tinta-suave">Ahorita no estás generando intereses</p>
        <p className="cifra font-titulo text-32 font-semibold">{mxn(0)}</p>
        <p className="text-12 text-tinta-suave">
          Traes saldo, pero está a meses sin intereses o tus tarjetas todavía no
          tienen tasa capturada.
        </p>
      </section>
    )
  }

  return (
    <section className="panel p-5" aria-labelledby="titulo-costo">
      <p id="titulo-costo" className="text-14 text-tinta-suave">
        Si no pagas tus saldos, este mes te van a cobrar
      </p>
      <p
        className="cifra font-titulo text-32 font-semibold"
        style={{ color: 'var(--naranja)' }}
      >
        {mxn(intereses)}
      </p>
      <p className="text-12 text-tinta-suave">
        Es interés sobre lo que traes debiendo. No baja un peso de tu deuda:
        aunque lo pagues, sigues debiendo lo mismo.
      </p>
    </section>
  )
}

// ------------------------------------------------------- explicación IA
function ExplicacionIA({ deuda }: { deuda: DeudaResponse }) {
  const [texto, setTexto] = useState<ExplicacionDeudaResponse | null>(null)
  const [pidiendo, setPidiendo] = useState(false)

  // La petición no lleva cuerpo: el backend recalcula el ranking. Esta huella
  // es solo para la caché de sesión — mientras el ranking no cambie, la
  // explicación tampoco, y no hay por qué volver a pedirla.
  //
  // Tiene que recorrer TODAS las filas. Antes era
  // `length + primer_id + total_redondeado`, y eso no distingue un reordenamiento
  // ni un cambio de costo por tarjeta: al corregir el cálculo de intereses, el
  // ranking se reordenó entero con la misma huella y la caché siguió sirviendo
  // un texto que hablaba de $380 sobre una fila que ya decía $5.35.
  const huella = deuda.ranking
    .map(r => `${r.tarjeta_id}:${Math.round(r.costo_intereses_mes)}`)
    .join('|') + '_' + Math.round(deuda.intereses_totales_mes)

  // Una sola vez por ranking. Si falla, no aparece y ya: el ranking y las
  // razones del backend nunca esperan a la IA. Un 503 —el servidor sin llave de
  // Gemini configurada— cae por aquí y no se muestra nada.
  useEffect(() => {
    let vivo = true
    setPidiendo(true)
    explicarPrioridad(huella)
      .then(r => { if (vivo) setTexto(r) })
      .catch(e => { console.warn('[ia] explicación no disponible:', e) })
      .finally(() => { if (vivo) setPidiendo(false) })
    return () => { vivo = false }
  }, [huella])

  if (pidiendo) {
    return (
      <div className="panel p-5 mt-4 space-y-2">
        <Cargando className="h-4 w-1/2" />
        <Cargando className="h-3 w-full" />
        <Cargando className="h-3 w-4/5" />
      </div>
    )
  }
  if (!texto) return null

  return (
    <section className="panel p-5 mt-4" aria-label="Explicación">
      <p className="font-titulo text-16">{texto.titular}</p>
      <p className="text-14 mt-2">{texto.explicacion}</p>
      {texto.comparativa && (
        <p className="text-14 text-tinta-suave mt-1.5">{texto.comparativa}</p>
      )}
      <p className="text-14 mt-3 font-medium">{texto.siguiente_paso}</p>

      <p className="text-12 text-tinta-suave mt-4 flex items-center gap-1.5">
        <Sparkles size={13} />
        Redactado por IA con los números de arriba
        {texto.confianza !== 'alta' && ` (confianza ${texto.confianza})`}
      </p>
    </section>
  )
}

// ------------------------------------------------------------ una fila
function FilaDeuda({
  posicion, deuda, corte, proximo, puedePagar, onPagar,
}: {
  posicion: number
  deuda: DeudaRanking
  corte: PagoPendiente | null
  proximo: ProximoPago | null
  puedePagar: boolean
  onPagar: () => void
}) {
  const primera = posicion === 1
  const color = primera ? 'var(--naranja)' : 'var(--tinta-suave)'

  return (
    <article
      className="panel p-4"
      style={primera ? { borderColor: 'var(--naranja)' } : undefined}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="cifra font-titulo text-20 font-semibold" style={{ color }}>
            {posicion}
          </span>
          <div className="min-w-0">
            <h3 className="text-16 font-medium truncate">{deuda.tarjeta}</h3>
            <p className="cifra text-14 text-tinta-suave">
              debes {mxn(deuda.saldo)}
            </p>
            {/* El saldo no es lo que toca pagar. Las dos cifras juntas, y la
                distancia entre ellas, son la lección de la pantalla. */}
            {proximo && (
              <p className="cifra text-14 mt-0.5">
                <span className="text-tinta-suave">{proximo.etiqueta}: </span>
                <span className="font-medium">{mxn(proximo.monto)}</span>
                {!proximo.evitaIntereses && (
                  <span className="text-12 text-tinta-suave"> · no evita intereses</span>
                )}
              </p>
            )}
          </div>
        </div>

        <Boton tono={primera ? 'primario' : 'secundario'} onClick={onPagar} disabled={!puedePagar}>
          Pagar
        </Boton>
      </div>

      <dl className="grid grid-cols-3 gap-3 mt-4">
        <Metrica etiqueta="Tasa" valor={pct(deuda.tasa)} sufijo="anual" />
        <Metrica etiqueta="Línea usada" valor={pctYa(deuda.utilizacion)} />
        <Metrica
          etiqueta="Intereses"
          valor={mxn(deuda.costo_intereses_mes)}
          sufijo="al mes"
          resaltar={primera}
        />
      </dl>

      <BloqueCorte corte={corte} saldoHoy={deuda.saldo} />

      {deuda.razones.length > 0 && (
        <ul className="mt-4 pt-3 border-t border-linea space-y-1">
          {deuda.razones.map(r => (
            <li key={r} className="text-14 text-tinta-suave flex gap-2">
              <span aria-hidden style={{ color }}>—</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}

      {!puedePagar && (
        <p className="text-12 text-tinta-suave mt-3">
          No se encontró esta tarjeta en tu lista, refresca la pantalla.
        </p>
      )}
    </article>
  )
}

/**
 * Lo que se debe A LA FECHA DEL CORTE.
 *
 * En crédito mexicano la tasa no la dispara el saldo de hoy: la dispara no
 * cubrir `pago_no_intereses` antes de la fecha límite. `deuda.saldo` y
 * `corte.saldo_al_corte` son dos números distintos —el primero incluye lo que
 * se gastó DESPUÉS del corte, que cae en el siguiente periodo— y la pantalla
 * los separa en vez de dejar que el usuario asuma que son el mismo.
 *
 * Todas las cifras vienen calculadas de GET /pagos-pendientes; aquí solo se
 * pintan, igual que en el aviso de cortes del Dashboard.
 */
function BloqueCorte({
  corte, saldoHoy,
}: { corte: PagoPendiente | null; saldoHoy: number }) {
  if (!corte) {
    // Sin fila no se puede afirmar mucho: `v_pagos_pendientes` solo devuelve
    // cortes CERRADOS y no cubiertos, así que la ausencia puede ser "todavía no
    // cierras el corte" o "ya lo pagaste". La frase no afirma ninguna de las dos.
    return (
      <div className="mt-4 pt-3 border-t border-linea">
        <p className="text-14 text-tinta-suave">
          No tienes un corte cerrado por cubrir en esta tarjeta.
        </p>
        <Link to="/tarjetas" className="text-14 underline inline-block py-2 -mb-1">
          Ver tus cortes
        </Link>
      </div>
    )
  }

  // Mismo umbral que el aviso del Dashboard: la urgencia sale de los días que
  // quedan, que los dice el backend. Ninguna pantalla inventa el suyo.
  const urgente = corte.dias_restantes <= 3
  const color = urgente ? 'var(--rojo)' : 'var(--ambar)'
  const posterior = saldoHoy - corte.saldo_al_corte

  return (
    <div className="mt-4 pt-3 border-t border-linea">
      <p className="text-14">
        Tu corte fue el {fecha(corte.fecha_corte)} y cerró en{' '}
        <span className="cifra font-medium">{mxn(corte.saldo_al_corte)}</span>.
      </p>
      <p className="text-14 mt-1">
        Paga{' '}
        <span className="cifra font-medium" style={{ color }}>
          {mxn(corte.falta_para_no_intereses)}
        </span>{' '}
        antes del {fecha(corte.fecha_limite_pago)} y no te cobran intereses.
      </p>
      <p className="text-12 text-tinta-suave mt-1">
        {corte.dias_restantes <= 0
          ? 'Ya venció el plazo.'
          : corte.dias_restantes === 1
            ? 'Te queda 1 día.'
            : `Te quedan ${corte.dias_restantes} días.`}
        {' '}El mínimo para no caer en mora son {mxn(corte.falta_para_no_mora)}.
      </p>
      {posterior > 0 && (
        <p className="text-12 text-tinta-suave mt-1">
          Debes {mxn(saldoHoy)} en total, pero {mxn(posterior)} lo gastaste
          después del corte y cae en el siguiente periodo.
        </p>
      )}
    </div>
  )
}

function Metrica({
  etiqueta, valor, sufijo, resaltar = false,
}: { etiqueta: string; valor: string; sufijo?: string; resaltar?: boolean }) {
  return (
    <div>
      <dt className="text-12 text-tinta-suave">{etiqueta}</dt>
      <dd
        className="cifra text-16 font-medium"
        style={resaltar ? { color: 'var(--naranja)' } : undefined}
      >
        {valor}
      </dd>
      {sufijo && <dd className="text-12 text-tinta-suave">{sufijo}</dd>}
    </div>
  )
}

// ---------------------------------------------------------- modal pago
interface OpcionMonto {
  clave: string
  etiqueta: string
  monto: number
  ayuda: string
}

/**
 * Los montos que significan algo, en orden de intención.
 *
 * El primero es SIEMPRE el próximo pago, venga del corte o del número capturado
 * en la tarjeta, y es el que viene prellenado. "Todo lo que debes" queda al
 * final: sigue disponible para quien quiera liquidar, pero dejó de ser el
 * defecto — sugerir la deuda entera cuando el usuario pregunta qué le toca
 * pagar era, justamente, el problema.
 */
function opcionesDe(
  deuda: DeudaRanking, corte: PagoPendiente | null, proximo: ProximoPago | null,
): OpcionMonto[] {
  const crudas: OpcionMonto[] = []

  if (proximo) {
    crudas.push({
      clave: 'proximo',
      etiqueta: proximo.etiqueta,
      monto: proximo.monto,
      ayuda: proximo.ayuda,
    })
  }

  // El mínimo solo existe como cifra propia cuando hay corte: fuera de ahí, el
  // backend guarda un único pago por tarjeta y ya salió como `proximo`.
  if (corte) {
    crudas.push({
      clave: 'sin_mora',
      etiqueta: 'Mínimo sin caer en mora',
      monto: Math.min(corte.falta_para_no_mora, deuda.saldo),
      ayuda: 'Lo más chico que te acepta el banco. Sobre lo que quede del corte sí te van a cobrar intereses.',
    })
  }

  crudas.push({
    clave: 'todo',
    etiqueta: 'Todo lo que debes',
    monto: deuda.saldo,
    ayuda: corte
      ? 'Incluye lo que gastaste después del corte, que en realidad cae en el siguiente periodo.'
      : 'Dejas la tarjeta en cero. Es más de lo que te toca pagar ahorita.',
  })

  // Fuera lo impagable y lo repetido: dos botones con la misma cifra son dos
  // botones que hacen lo mismo, y el usuario no sabría cuál elegir. El orden de
  // inserción decide cuál sobrevive, y por eso `proximo` va primero.
  const vistos = new Set<number>()
  return crudas.filter(o => {
    if (o.monto <= 0 || vistos.has(o.monto)) return false
    vistos.add(o.monto)
    return true
  })
}

function ModalPago({
  deuda, corte, proximo, onCerrar, onHecho,
}: {
  deuda: DeudaRanking
  corte: PagoPendiente | null
  proximo: ProximoPago | null
  onCerrar: () => void
  onHecho: (r: PagoResponse) => void
}) {
  const opciones = opcionesDe(deuda, corte, proximo)

  // Prellenado con el pago que toca, nunca con la deuda completa. Sin próximo
  // pago el campo nace VACÍO (`value={monto || ''}` lo hace con 0) y la ayuda
  // manda a capturarlo: un campo en blanco es más honesto que un número que no
  // significa nada.
  const [monto, setMonto] = useState(proximo?.monto ?? 0)
  const [medio, setMedio] = useState<MedioSalida>('debito')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)
  // Una clave por gesto: si el envio truena y se reintenta, el pago no se
  // aplica dos veces.
  const { clave, gestoCompletado } = useClaveIdempotencia()

  // Derivada, no en estado: la explicación es función del monto, y guardarla
  // aparte solo abriría la puerta a que se desincronicen.
  const activa = opciones.find(o => o.monto === monto) ?? null

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setError(null)
    try {
      const r = await api.pagarDeuda(
        { tarjeta_id: deuda.tarjeta_id, monto, medio }, clave(),
      )
      gestoCompletado()
      onHecho(r)
    } catch (err) {
      setError(err)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo={`Pagar a ${deuda.tarjeta}`} onCerrar={onCerrar}>
      <form onSubmit={enviar} className="space-y-4">
        <div>
          <label htmlFor="monto-pago" className="etiqueta">¿Cuánto vas a abonar?</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-tinta-suave text-20">$</span>
            <input
              id="monto-pago"
              type="number"
              min={1}
              max={deuda.saldo}
              step="any"
              value={monto || ''}
              onChange={e => setMonto(Number(e.target.value))}
              aria-describedby="pie-monto ayuda-monto"
              className="control cifra text-32 font-titulo pl-8 py-2"
            />
          </div>
          {/* Lidera el pago que toca; la deuda total va después. Al revés —como
              estaba— el número grande de la frase era el que NO hay que pagar. */}
          <p id="pie-monto" className="text-12 text-tinta-suave mt-1 cifra">
            {corte
              ? `De tu corte del ${fecha(corte.fecha_corte)} faltan ${mxn(corte.falta_para_no_intereses)} · debes ${mxn(deuda.saldo)} en total`
              : proximo
                ? `${proximo.etiqueta}: ${mxn(proximo.monto)} · debes ${mxn(deuda.saldo)} en total`
                : `Debes ${mxn(deuda.saldo)} en total`}
          </p>
        </div>

        <div role="group" aria-labelledby="titulo-montos">
          <p id="titulo-montos" className="etiqueta">Montos que significan algo</p>
          <div className="flex gap-2 flex-wrap">
            {opciones.map(o => {
              const elegida = o.monto === monto
              return (
                <button
                  key={o.clave}
                  type="button"
                  aria-pressed={elegida}
                  onClick={() => setMonto(o.monto)}
                  className={`cifra text-14 px-3 py-1.5 rounded-full border text-tinta-suave
                              hover:border-tinta-suave
                              ${elegida ? 'border-tinta-suave' : 'border-linea'}`}
                >
                  {o.etiqueta} · {mxn(o.monto)}
                </button>
              )
            })}
          </div>
          <p id="ayuda-monto" className="text-12 text-tinta-suave mt-2">
            {activa
              ? activa.ayuda
              : 'Monto libre: no corresponde a ninguno de los de arriba.'}
          </p>

          {!proximo && (
            <p className="text-12 text-tinta-suave mt-2">
              Todavía no sabemos cuánto te toca pagar en esta tarjeta.{' '}
              <Link to="/tarjetas" className="underline">
                Captura tu pago o cierra tu corte
              </Link>{' '}
              y te lo sugerimos aquí.
            </p>
          )}
        </div>

        <CampoSelect
          etiqueta="¿De dónde sale?"
          value={medio}
          onChange={e => setMedio(e.target.value as MedioSalida)}
        >
          <option value="debito">De mi cuenta</option>
          <option value="efectivo">En efectivo</option>
        </CampoSelect>

        {error != null && <ErrorLinea error={error} />}

        <div className="flex gap-2 justify-end pt-1">
          <Boton type="button" tono="fantasma" onClick={onCerrar}>Cancelar</Boton>
          <Boton type="submit" tono="primario" cargando={enviando}>Pagar</Boton>
        </div>
      </form>
    </Modal>
  )
}

// -------------------------------------------------------- modal recibo
function ModalRecibo({
  recibo, onCerrar,
}: { recibo: PagoResponse; onCerrar: () => void }) {
  const bajo = recibo.score_despues < recibo.score_antes
  return (
    <Modal titulo="Pagado" onCerrar={onCerrar}>
      <p className="text-14 text-tinta-suave">Dejas de pagar</p>
      <p
        className="cifra font-titulo text-56 font-semibold leading-none mt-1"
        style={{ color: colorBanda('verde') }}
      >
        {mxn(recibo.ahorro_intereses_mensual)}
      </p>
      <p className="text-16 mt-1">al mes en intereses</p>

      <dl className="grid grid-cols-2 gap-3 mt-6 pt-4 border-t border-linea">
        <div>
          <dt className="text-12 text-tinta-suave">Ahora debes</dt>
          <dd className="cifra text-16 font-medium">{mxn(recibo.nuevo_saldo_tarjeta)}</dd>
        </div>
        <div>
          <dt className="text-12 text-tinta-suave">Tu score</dt>
          <dd className="cifra text-16 font-medium">
            {recibo.score_antes} → {recibo.score_despues}
          </dd>
          {bajo && (
            <dd className="text-12 text-tinta-suave">
              Bajó porque usaste parte de tu efectivo; el ahorro es permanente.
            </dd>
          )}
        </div>
      </dl>

      <div className="flex justify-end mt-6">
        <Boton tono="primario" onClick={onCerrar}>Listo</Boton>
      </div>
    </Modal>
  )
}
