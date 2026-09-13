/**
 * "¿Me conviene comprar esto?" — la pantalla estrella.
 *
 * EL FLUJO, en tres bloques que se leen de arriba abajo:
 *
 *   1. Qué vas a comprar        monto y descripción
 *   2. Cómo te lo ofrecen       la MESA: tu efectivo y las tarjetas que vas a
 *                               poder usar en ESA tienda, cada una con los
 *                               meses que te ofrecen CON ELLA
 *   3. Qué te conviene          el veredicto del motor, las formas de pagarlo
 *                               ordenadas, y el análisis profundo si lo pides
 *
 * El bloque 2 es el que cambió. Antes había una sola lista de meses que se
 * aplicaba a todas las tarjetas, o sea que la pantalla comparaba ofertas que
 * nadie le había hecho al usuario: la misma tienda da 18 meses con una tarjeta
 * y ninguno con otra.
 *
 * Lo que se pide sigue siendo de SOLO LECTURA. Lo único que escribe es el botón
 * "Elegir esta", que registra la compra como movimiento — y eso es un POST
 * aparte, con su clave de idempotencia.
 */
import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
} from 'react'
import { Plus, Sparkles, TriangleAlert, X } from 'lucide-react'
import * as api from '../lib/api'
import { usarDatos } from '../lib/usarDatos'
import { analizarCompra } from '../lib/ia'
import { useCategorias, CLAVE_POR_DEFECTO } from '../lib/categorias'
import { useClaveIdempotencia } from '../lib/idempotencia'
import {
  bandaDeScore, colorBanda, colorVeredicto, conSigno, hoyISO, mxn,
  NOMBRE_VEREDICTO, nombreModalidad,
} from '../lib/formato'
import { PLAZOS_COMUNES } from '../lib/tipos'
import type {
  AnalisisCompraResponse, Escenario, Estado, MedioSalida, MovimientoCreate,
  MovimientoResponse, OpcionTarjeta, SimulacionRequest, SimulacionResponse,
  TarjetaEstado,
} from '../lib/tipos'
import Encabezado from '../componentes/Encabezado'
import Boton from '../componentes/Boton'
import Cargando from '../componentes/Cargando'
import ErrorApi, { ErrorLinea } from '../componentes/ErrorApi'
import Modal from '../componentes/Modal'
import Campo, { CampoSelect } from '../componentes/Campo'
import Vacio from '../componentes/Vacio'

export default function Simulador() {
  const cargarEstado = useCallback(() => api.estado(), [])
  const { datos: estado, recargar: recargarEstado } = usarDatos(cargarEstado)

  const [monto, setMonto] = useState(15000)
  const [descripcion, setDescripcion] = useState('')

  // LA MESA: con qué se puede pagar en ESTA tienda. El efectivo va aparte
  // porque no lleva meses; las tarjetas traen cada una SUS plazos.
  const [contado, setContado] = useState(true)
  const [mesa, setMesa] = useState<OpcionTarjeta[]>([])

  const [resultado, setResultado] = useState<SimulacionResponse | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [pidiendo, setPidiendo] = useState(false)

  const [eligiendo, setEligiendo] = useState<Escenario | null>(null)
  const [registrado, setRegistrado] = useState<MovimientoResponse | null>(null)
  // Registrar una compra mueve los saldos: hay que volver a simular aunque la
  // pregunta sea la misma, y la huella por sí sola no cambiaría.
  const [version, setVersion] = useState(0)

  const hayMesa = contado || mesa.length > 0

  /**
   * La huella de la pregunta. Hace tres trabajos:
   *   - es la dependencia estable del efecto (`mesa` es un array nuevo en cada
   *     render y no sirve como dependencia)
   *   - es la clave de caché del análisis
   *   - INVALIDA el análisis: si cambia la pregunta, el texto viejo deja de
   *     pintarse. Sin esto quedaría prosa vieja junto a números nuevos, que es
   *     el peor error posible en esta pantalla.
   */
  const huella = [
    monto, descripcion, contado ? 'c' : '',
    ...mesa.map(o => `${o.tarjeta_id}:${o.plazos.join('.')}`),
  ].join('|')

  const contador = useRef(0)

  useEffect(() => {
    if (!(monto > 0) || !hayMesa) { setResultado(null); return }
    const temporizador = setTimeout(() => {
      const mio = ++contador.current
      setPidiendo(true)
      api.simular(peticionDe(monto, descripcion, contado, mesa))
        .then(r => { if (mio === contador.current) { setResultado(r); setError(null) } })
        .catch(e => { if (mio === contador.current) setError(e) })
        .finally(() => { if (mio === contador.current) setPidiendo(false) })
    }, 300)
    return () => clearTimeout(temporizador)
    // `huella` representa a monto, descripción y mesa como un valor estable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [huella, hayMesa, version])

  const contenedor = useReordenar(resultado?.escenarios)

  const claveRecomendado = resultado?.recomendado
    ? claveEscenario(resultado.recomendado)
    : null

  function alRegistrar(r: MovimientoResponse) {
    setEligiendo(null)
    setRegistrado(r)
    recargarEstado()
    setVersion(v => v + 1)
  }

  return (
    <>
      <Encabezado titulo="¿Me conviene comprar esto?" />

      <QueCompras
        monto={monto} setMonto={setMonto}
        descripcion={descripcion} setDescripcion={setDescripcion}
        estado={estado}
      />

      <Mesa
        estado={estado}
        contado={contado} setContado={setContado}
        mesa={mesa} setMesa={setMesa}
      />

      {registrado && (
        <Registrado resultado={registrado} onCerrar={() => setRegistrado(null)} />
      )}

      {error != null && <div className="mt-4"><ErrorApi error={error} /></div>}

      {!hayMesa && (
        <div className="mt-4">
          <Vacio
            titulo="Dinos con qué podrías pagarlo"
            detalle="Agrega arriba tu efectivo o las tarjetas que vas a poder usar en esa
                     tienda. Sin eso no hay nada que comparar."
          />
        </div>
      )}

      {hayMesa && resultado === null && error == null && (
        <div className="panel p-5 mt-4 space-y-3">
          <Cargando className="h-6 w-1/2" />
          <Cargando className="h-20 w-full" />
        </div>
      )}

      {hayMesa && resultado && (
        <div className={pidiendo ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <Veredicto resultado={resultado} />

          {resultado.recomendado && (
            <Recomendado
              escenario={resultado.recomendado}
              scoreActual={resultado.score_actual}
              onElegir={() => setEligiendo(resultado.recomendado)}
            />
          )}

          <h2 className="font-titulo text-16 mt-5 mb-2">Todas las formas de pagarlo</h2>
          <div ref={contenedor} className="space-y-2">
            {resultado.escenarios.map(e => (
              <FilaEscenario
                key={claveEscenario(e)}
                escenario={e}
                // Por clave y NO por identidad: `recomendado` y su fila en
                // `escenarios` son el mismo dict en el servidor, pero el JSON
                // los deserializa como dos objetos distintos y `===` nunca
                // sería cierto.
                esRecomendado={claveEscenario(e) === claveRecomendado}
                onElegir={() => setEligiendo(e)}
              />
            ))}
          </div>

          <AnalisisProfundo
            peticion={peticionDe(monto, descripcion, contado, mesa)}
            huella={huella}
            hayRecomendado={resultado.recomendado !== null}
          />
        </div>
      )}

      {eligiendo && (
        <ModalRegistrar
          escenario={eligiendo}
          monto={resultado?.monto ?? monto}
          descripcion={descripcion}
          onCerrar={() => setEligiendo(null)}
          onHecho={alRegistrar}
        />
      )}
    </>
  )
}

/** El cuerpo que consumen los DOS endpoints: la simulación y su análisis. */
function peticionDe(
  monto: number, descripcion: string, contado: boolean, mesa: OpcionTarjeta[],
): SimulacionRequest {
  return {
    monto,
    descripcion: descripcion.trim() || null,
    tarjetas: mesa,
    incluir_contado: contado,
  }
}

const claveEscenario = (e: Escenario) =>
  `${e.modalidad ?? 'na'}-${e.tarjeta_id ?? 'efectivo'}`

// ==================================================== 1. qué vas a comprar
function QueCompras({
  monto, setMonto, descripcion, setDescripcion, estado,
}: {
  monto: number
  setMonto: (n: number) => void
  descripcion: string
  setDescripcion: (s: string) => void
  estado: Estado | null
}) {
  // El techo del slider sale de lo que el usuario realmente tiene: efectivo
  // más la línea de crédito más grande. Nada hardcodeado.
  const techo = estado
    ? Math.max(
        10000,
        Math.ceil(
          (Math.max(estado.liquidez, ...estado.tarjetas.map(t => t.disponible), 0) * 1.3) / 1000,
        ) * 1000,
      )
    : 50000

  return (
    <section className="panel p-5" aria-label="Qué vas a comprar">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <label htmlFor="monto" className="etiqueta">¿Cuánto cuesta?</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-tinta-suave text-20">
              $
            </span>
            <input
              id="monto"
              type="number"
              min={0}
              // step="any": con un step numérico el navegador rechaza montos
              // que no caen en la rejilla (15,750 con step 100).
              step="any"
              value={monto || ''}
              onChange={e => setMonto(Number(e.target.value))}
              className="control cifra text-32 font-titulo pl-8 py-2"
            />
          </div>
          <input
            type="range"
            min={500}
            max={techo}
            step={500}
            value={Math.min(monto, techo)}
            onChange={e => setMonto(Number(e.target.value))}
            aria-label="Monto de la compra"
            className="mt-4"
          />
          <div className="flex justify-between text-12 text-tinta-suave mt-1 cifra">
            <span>{mxn(500)}</span>
            <span>{mxn(techo)}</span>
          </div>
        </div>

        <div>
          <label htmlFor="descripcion" className="etiqueta">¿Qué vas a comprar?</label>
          <input
            id="descripcion"
            value={descripcion}
            onChange={e => setDescripcion(e.target.value)}
            placeholder="Laptop, refrigerador, boletos…"
            className="control"
          />
          <p className="text-12 text-tinta-suave mt-2">
            Con esto el análisis profundo puede categorizar la compra y el
            movimiento queda con su nombre.
          </p>
        </div>
      </div>
    </section>
  )
}

// ================================================= 2. cómo te lo ofrecen
/**
 * La mesa: las formas de pago que esa tienda te está ofreciendo.
 *
 * Filas divididas dentro de UN panel, no un panel por fila: son partes de una
 * misma decisión, no tarjetas independientes.
 */
function Mesa({
  estado, contado, setContado, mesa, setMesa,
}: {
  estado: Estado | null
  contado: boolean
  setContado: (b: boolean) => void
  mesa: OpcionTarjeta[]
  setMesa: (f: (m: OpcionTarjeta[]) => OpcionTarjeta[]) => void
}) {
  if (!estado) {
    return (
      <section className="panel p-5 mt-4 space-y-3">
        <Cargando className="h-4 w-1/3" />
        <Cargando className="h-12 w-full" />
      </section>
    )
  }

  const enMesa = new Set(mesa.map(o => o.tarjeta_id))
  const disponibles = estado.tarjetas.filter(t => !enMesa.has(t.id))
  const porId = new Map(estado.tarjetas.map(t => [t.id, t]))

  const alternarPlazo = (tarjetaId: string, meses: number) =>
    setMesa(m => m.map(o => o.tarjeta_id !== tarjetaId ? o : {
      ...o,
      plazos: o.plazos.includes(meses)
        ? o.plazos.filter(p => p !== meses)
        : [...o.plazos, meses].sort((a, b) => a - b),
    }))

  return (
    <section className="panel px-5 py-4 mt-4" aria-label="Cómo te lo ofrecen">
      <h2 className="font-titulo text-16">¿Cómo te lo ofrecen?</h2>
      <p className="text-12 text-tinta-suave mt-0.5 mb-1">
        Los meses los pone la tienda, y no da los mismos con todas tus tarjetas.
      </p>

      <div className="flex items-center justify-between gap-4 py-3 border-t border-linea">
        <div className="min-w-0">
          <p className="text-14 font-medium">Con tu dinero</p>
          <p className="text-12 text-tinta-suave cifra">
            {mxn(estado.liquidez)} disponibles
          </p>
        </div>
        <button
          type="button"
          aria-pressed={contado}
          onClick={() => setContado(!contado)}
          className={[
            'text-14 px-3 py-1.5 rounded-full border transition-colors shrink-0',
            contado
              ? 'bg-accion text-white border-accion'
              : 'bg-superficie text-tinta-suave border-linea hover:border-tinta-suave',
          ].join(' ')}
        >
          {contado ? 'En la mesa' : 'Agregar'}
        </button>
      </div>

      {mesa.map(opcion => {
        const t = porId.get(opcion.tarjeta_id)
        if (!t) return null
        return (
          <FilaTarjeta
            key={opcion.tarjeta_id}
            tarjeta={t}
            plazos={opcion.plazos}
            onAlternar={meses => alternarPlazo(opcion.tarjeta_id, meses)}
            onQuitar={() =>
              setMesa(m => m.filter(o => o.tarjeta_id !== opcion.tarjeta_id))}
          />
        )
      })}

      {estado.tarjetas.length === 0 ? (
        <p className="text-12 text-tinta-suave pt-3 border-t border-linea">
          No tienes tarjetas de crédito con términos completos, así que solo se
          puede comparar contra tu efectivo.
        </p>
      ) : disponibles.length > 0 && (
        <div className="pt-3 border-t border-linea">
          <p className="etiqueta">Agregar una tarjeta a la comparación</p>
          <div className="flex flex-wrap gap-2">
            {disponibles.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setMesa(m => [...m, { tarjeta_id: t.id, plazos: [] }])}
                className="text-14 px-3 py-1.5 rounded-full border border-linea
                           text-tinta-suave hover:border-tinta-suave
                           inline-flex items-center gap-1.5"
              >
                <Plus size={14} aria-hidden />
                {t.nombre}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function FilaTarjeta({
  tarjeta, plazos, onAlternar, onQuitar,
}: {
  tarjeta: TarjetaEstado
  plazos: number[]
  onAlternar: (meses: number) => void
  onQuitar: () => void
}) {
  return (
    <div className="py-3 border-t border-linea">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="text-14 font-medium truncate">{tarjeta.nombre}</p>
          <p className="text-12 text-tinta-suave cifra">
            {mxn(tarjeta.disponible)} de línea disponible
          </p>
        </div>
        <button
          type="button"
          onClick={onQuitar}
          aria-label={`Quitar ${tarjeta.nombre} de la comparación`}
          className="text-tinta-suave hover:text-tinta shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      <p className="etiqueta mt-2.5">Meses que te ofrecen con esta tarjeta</p>
      {/* Cada fila necesita su propia etiqueta: si no, un lector de pantalla
          anuncia varios grupos de chips idénticos sin decir de cuál son. */}
      <div
        role="group"
        aria-label={`Meses sin intereses que la tienda ofrece con ${tarjeta.nombre}`}
        className="flex flex-wrap gap-2"
      >
        {PLAZOS_COMUNES.map(p => (
          <ChipPlazo
            key={p}
            meses={p}
            activo={plazos.includes(p)}
            onClick={() => onAlternar(p)}
          />
        ))}
      </div>
      {plazos.length === 0 && (
        <p className="text-12 text-tinta-suave mt-2">
          Sin meses: con esta tarjeta solo se compara el crédito revolvente.
        </p>
      )}
    </div>
  )
}

function ChipPlazo({
  meses, activo, onClick,
}: { meses: number; activo: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={[
        'cifra text-14 px-3 py-1.5 rounded-full border transition-colors',
        activo
          ? 'bg-accion text-white border-accion'
          : 'bg-superficie text-tinta-suave border-linea hover:border-tinta-suave',
      ].join(' ')}
    >
      {meses} meses
    </button>
  )
}

// ==================================================== 3. qué te conviene
/**
 * El veredicto del MOTOR, no de la IA.
 *
 * Va antes que la recomendación a propósito: "con qué te conviene pagarlo" no
 * sirve de nada si la respuesta a "¿lo compro?" era que no. Y aparece aunque
 * Gemini esté caído, porque no pasa por él.
 */
function Veredicto({ resultado }: { resultado: SimulacionResponse }) {
  const { veredicto, razones_veredicto: razones } = resultado
  const color = colorVeredicto(veredicto)

  if (veredicto === 'conviene' && resultado.recomendado) return null

  return (
    <section
      className="panel p-5 mt-4"
      style={{ borderColor: color, borderLeftWidth: 3 }}
      aria-label="Veredicto"
    >
      <p className="font-titulo text-16 flex items-center gap-2" style={{ color }}>
        <TriangleAlert size={16} aria-hidden />
        {NOMBRE_VEREDICTO[veredicto]}
      </p>
      {razones.length > 0 && (
        <ul className="mt-2 space-y-1">
          {razones.map(r => (
            <li key={r} className="text-14 text-tinta-suave flex gap-2">
              <span aria-hidden style={{ color }}>—</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
      {!resultado.recomendado && (
        <p className="text-14 mt-3">
          Abajo está el porqué de cada forma de pago.
        </p>
      )}
    </section>
  )
}

function Recomendado({
  escenario, scoreActual, onElegir,
}: { escenario: Escenario; scoreActual: number; onElegir: () => void }) {
  const color = colorBanda(bandaDeScore(escenario.score_despues ?? 0).color)
  const esContado = escenario.modalidad === 'contado'

  return (
    <section
      className="panel p-5 mt-4"
      style={{ borderColor: 'var(--accion)', borderWidth: 2 }}
      aria-label="Opción recomendada"
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-12 text-tinta-suave">Te conviene</p>
          <h2 className="font-titulo text-20 mt-0.5">
            {nombreModalidad(escenario.modalidad, escenario.tarjeta)}
          </h2>
        </div>
        <Boton tono="primario" onClick={onElegir}>Elegir esta</Boton>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 mt-4">
        <div>
          <p className="text-12 text-tinta-suave">
            {esContado ? 'Pagas hoy' : 'Pagas cada mes'}
          </p>
          <p className="cifra text-32 font-titulo font-semibold">
            {esContado ? 'Todo de una' : mxn(escenario.pago_mensual)}
          </p>
          {/* El costo total es lo que separa 18 meses de revolver: sin él, dos
              opciones con pago mensual parecido se ven iguales y no lo son. */}
          <p className="text-12 text-tinta-suave cifra">
            te sale en {mxn(escenario.costo_total)} en total
          </p>
        </div>
        <div>
          <p className="text-12 text-tinta-suave">
            {esContado ? 'Te quedarían' : 'Línea que te queda'}
          </p>
          <p className="cifra text-32 font-titulo font-semibold">
            {mxn(escenario.holgura_despues)}
          </p>
        </div>
        <div>
          <p className="text-12 text-tinta-suave">Tu score quedaría en</p>
          <p className="cifra text-32 font-titulo font-semibold" style={{ color }}>
            {escenario.score_despues}
            <span className="text-16 font-sans font-medium ml-2">
              {conSigno(escenario.delta)}
            </span>
          </p>
          <p className="text-12 text-tinta-suave">hoy tienes {scoreActual}</p>
        </div>
      </div>
    </section>
  )
}

function FilaEscenario({
  escenario, esRecomendado, onElegir,
}: { escenario: Escenario; esRecomendado: boolean; onElegir: () => void }) {
  const viable = escenario.viable
  const color = colorBanda(bandaDeScore(escenario.score_despues ?? 0).color)

  return (
    <article
      data-clave={claveEscenario(escenario)}
      aria-disabled={!viable}
      className="panel px-4 py-3 flex items-center justify-between gap-4 flex-wrap"
      style={viable ? undefined : { opacity: 0.62, background: 'var(--papel)' }}
    >
      <div className="min-w-0">
        <p className="text-14 font-medium flex items-center gap-2 flex-wrap">
          {nombreModalidad(escenario.modalidad, escenario.tarjeta)}
          {esRecomendado && (
            <span className="text-12 font-normal text-accion border border-accion/40 rounded px-1.5">
              recomendado
            </span>
          )}
        </p>
        <p className="text-12 text-tinta-suave mt-0.5">
          {viable ? detalleViable(escenario) : escenario.motivo}
        </p>
      </div>

      <div className="flex items-center gap-5 shrink-0">
        {viable && escenario.modalidad !== 'contado' && (
          <div className="text-right">
            <p className="text-12 text-tinta-suave">al mes</p>
            <p className="cifra text-16 font-medium">{mxn(escenario.pago_mensual)}</p>
          </div>
        )}
        <div className="text-right w-[86px]">
          <p className="text-12 text-tinta-suave">score</p>
          {/* El backend sí calcula el score del contado inviable: se muestra. */}
          {escenario.score_despues !== null ? (
            <p className="cifra text-16 font-medium" style={{ color }}>
              {escenario.score_despues}
              <span className="text-12 text-tinta-suave ml-1.5">
                {conSigno(escenario.delta)}
              </span>
            </p>
          ) : (
            <p className="cifra text-16 text-tinta-suave">—</p>
          )}
        </div>
        {viable && !esRecomendado && (
          <Boton tono="secundario" onClick={onElegir}>Elegir</Boton>
        )}
      </div>
    </article>
  )
}

function detalleViable(e: Escenario): string {
  if (e.modalidad === 'contado') {
    return `Sale de tu efectivo, te quedarían ${mxn(e.holgura_despues)}`
  }
  // El revolvente es el único que cuesta más que el precio, y decirlo aquí es
  // lo que impide que se lea igual que unos meses sin intereses.
  if (e.modalidad === 'credito' && e.costo_total !== null) {
    return `Con intereses te sale en ${mxn(e.costo_total)} · te queda línea de ${mxn(e.holgura_despues)}`
  }
  return `Te quedan ${mxn(e.holgura_despues)} de línea disponible`
}

// ------------------------------------------------------ análisis profundo
/**
 * La simulación, contada por Gemini.
 *
 * NO es automático como la explicación de deuda: cuesta dinero y tarda
 * segundos, así que lo dispara un botón. Y no se pinta si la pregunta cambió:
 * `analisis.huella !== huella` significa texto viejo sobre números nuevos.
 */
function AnalisisProfundo({
  peticion, huella, hayRecomendado,
}: { peticion: SimulacionRequest; huella: string; hayRecomendado: boolean }) {
  const [guardado, setGuardado] = useState<
    { huella: string; dato: AnalisisCompraResponse } | null
  >(null)
  const [pidiendo, setPidiendo] = useState(false)
  const [error, setError] = useState<unknown>(null)

  // Derivado en render, no en un efecto: cambiar la mesa invalida el análisis
  // sin que haya que acordarse de limpiarlo.
  const analisis = guardado?.huella === huella ? guardado.dato : null

  async function pedir() {
    setPidiendo(true)
    setError(null)
    try {
      setGuardado({ huella, dato: await analizarCompra(peticion, huella) })
    } catch (e) {
      setError(e)
    } finally {
      setPidiendo(false)
    }
  }

  if (!analisis) {
    return (
      <section className="panel p-5 mt-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="text-16 font-medium">¿Por qué esa y no otra?</p>
            <p className="text-14 text-tinta-suave mt-1 max-w-md">
              {hayRecomendado
                ? 'Compara la mejor opción de cada tarjeta contra tu efectivo y te lo explica con tus números.'
                : 'Aun sin forma de pago viable, te dice qué falta para que esta compra quepa.'}
            </p>
          </div>
          <Boton tono="primario" onClick={pedir} cargando={pidiendo}>
            <Sparkles size={15} aria-hidden />
            Análisis profundo
          </Boton>
        </div>
        {error != null && (
          <div className="mt-3">
            <ErrorLinea error={error} />
            <p className="text-12 text-tinta-suave mt-1">
              La comparación de arriba no depende de esto: sigue siendo válida.
            </p>
          </div>
        )}
      </section>
    )
  }

  const color = colorVeredicto(analisis.veredicto)
  return (
    <section className="panel p-5 mt-5" aria-label="Análisis profundo" aria-live="polite">
      <p className="font-titulo text-16">{analisis.titular}</p>
      <p className="text-14 mt-2">{analisis.explicacion}</p>

      {analisis.comparativas.length > 0 && (
        <ul className="mt-3 space-y-1">
          {analisis.comparativas.map(c => (
            <li key={c} className="text-14 text-tinta-suave flex gap-2">
              <span aria-hidden className="text-tinta-suave">—</span>
              <span>{c}</span>
            </li>
          ))}
        </ul>
      )}

      {analisis.reflexion && (
        <p
          className="text-16 mt-4 pt-4 border-t border-linea"
          style={{ color }}
        >
          {analisis.reflexion}
        </p>
      )}

      <p className="text-12 text-tinta-suave mt-4 flex items-center gap-1.5">
        <Sparkles size={13} aria-hidden />
        Redactado por IA sobre los números del motor · lo clasificó como{' '}
        {analisis.categoria_nombre}
        {analisis.confianza !== 'alta' && ` (confianza ${analisis.confianza})`}
      </p>
    </section>
  )
}

// -------------------------------------------------- registrar la compra
/**
 * El único punto de esta pantalla que ESCRIBE.
 *
 * No hay endpoint nuevo: una compra es un movimiento como cualquier otro, y el
 * escenario elegido decide su forma. Los tres casos y lo que mueve cada uno:
 *
 *   contado    -> gasto en efectivo o débito, baja la liquidez
 *   revolvente -> gasto a crédito, sube el saldo de la tarjeta
 *   N meses    -> lo mismo MÁS el plan a meses, en la misma transacción
 */
function ModalRegistrar({
  escenario, monto, descripcion, onCerrar, onHecho,
}: {
  escenario: Escenario
  monto: number
  descripcion: string
  onCerrar: () => void
  onHecho: (r: MovimientoResponse) => void
}) {
  const { categorias } = useCategorias()
  const { clave, gestoCompletado } = useClaveIdempotencia()

  const [categoria, setCategoria] = useState(CLAVE_POR_DEFECTO)
  const [concepto, setConcepto] = useState(descripcion)
  const [fecha, setFecha] = useState(hoyISO())
  const [medio, setMedio] = useState<MedioSalida>('debito')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const esContado = escenario.modalidad === 'contado'
  const meses = mesesDe(escenario)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setEnviando(true)

    const texto = concepto.trim()
    // `tarjeta_id` se OMITE cuando no toca: mandarlo en null también es 422.
    const cuerpo: MovimientoCreate = {
      tipo: 'gasto',
      medio: esContado ? medio : 'credito',
      monto,
      fecha,
      categoria,
      ...(texto ? { descripcion: texto } : {}),
      ...(esContado ? {} : { tarjeta_id: escenario.tarjeta_id! }),
      ...(meses ? {
        msi: {
          meses,
          ...(texto ? { descripcion: texto } : {}),
          monto_mensual: escenario.pago_mensual,
        },
      } : {}),
    }

    try {
      const r = await api.registrarMovimiento(cuerpo, clave())
      gestoCompletado()
      onHecho(r)
    } catch (err) {
      setError(err)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo="Registrar esta compra" onCerrar={onCerrar}>
      <form onSubmit={enviar} className="space-y-4" noValidate>
        <div>
          <p className="text-12 text-tinta-suave">Vas a registrar</p>
          <p className="text-16 font-medium">
            {nombreModalidad(escenario.modalidad, escenario.tarjeta)}
          </p>
          <p className="cifra text-32 font-titulo font-semibold mt-1">{mxn(monto)}</p>
          {meses && (
            <p className="text-12 text-tinta-suave cifra">
              {mxn(escenario.pago_mensual)} al mes durante {meses} meses
            </p>
          )}
        </div>

        {esContado && (
          <CampoSelect
            etiqueta="¿De dónde sale?"
            value={medio}
            onChange={e => setMedio(e.target.value as MedioSalida)}
          >
            <option value="debito">De mi cuenta</option>
            <option value="efectivo">En efectivo</option>
          </CampoSelect>
        )}

        <CampoSelect
          etiqueta="¿En qué?"
          value={categoria}
          onChange={e => setCategoria(e.target.value)}
        >
          {categorias.map(c => (
            <option key={c.clave} value={c.clave}>{c.nombre}</option>
          ))}
        </CampoSelect>

        <Campo
          etiqueta="¿Qué fue?"
          value={concepto}
          onChange={e => setConcepto(e.target.value)}
          placeholder="Laptop, refrigerador…"
          ayuda="Opcional"
        />

        <Campo
          etiqueta="¿Cuándo?"
          type="date"
          max={hoyISO()}
          value={fecha}
          onChange={e => setFecha(e.target.value)}
        />

        {error != null && <ErrorLinea error={error} />}

        <div className="flex gap-2 justify-end pt-1">
          <Boton type="button" tono="fantasma" onClick={onCerrar}>Cancelar</Boton>
          <Boton type="submit" tono="primario" cargando={enviando}>
            Registrar
          </Boton>
        </div>
      </form>
    </Modal>
  )
}

/** Los meses de un escenario a MSI; null en contado y revolvente. */
function mesesDe(e: Escenario): number | null {
  if (!e.modalidad || !e.modalidad.endsWith('_msi')) return null
  return parseInt(e.modalidad.split('_')[0], 10)
}

function Registrado({
  resultado, onCerrar,
}: { resultado: MovimientoResponse; onCerrar: () => void }) {
  // La clave de idempotencia ya se había usado: el movimiento existía y el
  // saldo NO se movió otra vez.
  if (resultado.repetido) {
    return (
      <section className="panel p-4 mt-4" aria-live="polite">
        <p className="text-14 font-medium">Ya estaba registrado</p>
        <p className="text-12 text-tinta-suave mt-1">
          Esta compra ya se había guardado, así que tu saldo no se movió otra vez.
        </p>
      </section>
    )
  }

  const { impacto } = resultado
  // Los dos scores son floats: una compra chica los mueve menos de un punto y
  // los DOS se pintan igual. Comparar los exactos hacía aparecer "bajó" junto a
  // un "80 → 80" que dice lo contrario, así que se comparan los redondeados.
  const antes = Math.round(impacto.score_antes)
  const despues = Math.round(impacto.score_despues)
  const bajo = despues < antes

  return (
    <section
      className="panel p-4 mt-4 flex items-center justify-between gap-4 flex-wrap"
      aria-live="polite"
      style={{ borderColor: 'var(--accion)' }}
    >
      <div>
        <p className="text-14 font-medium">Compra registrada</p>
        <p className="text-12 text-tinta-suave">
          Tus saldos ya se ajustaron y la comparación de abajo se rehizo con
          ellos.
        </p>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-12 text-tinta-suave">tu score</p>
          <p className="cifra text-16 font-medium">{antes} → {despues}</p>
          {bajo && (
            <p className="text-12 text-tinta-suave">bajó con esta compra</p>
          )}
        </div>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Ocultar el aviso"
          className="text-tinta-suave hover:text-tinta"
        >
          <X size={16} />
        </button>
      </div>
    </section>
  )
}

/**
 * Cuando cambia el monto la lista se reordena; el movimiento se anima con
 * FLIP para que el usuario vea qué subió y qué bajó, no un salto.
 */
function useReordenar(dep: unknown) {
  const contenedor = useRef<HTMLDivElement>(null)
  const posiciones = useRef(new Map<string, number>())

  useLayoutEffect(() => {
    const nodo = contenedor.current
    if (!nodo) return
    const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const nuevas = new Map<string, number>()

    for (const hijo of Array.from(nodo.children) as HTMLElement[]) {
      const clave = hijo.dataset.clave
      if (!clave) continue
      const arriba = hijo.offsetTop
      const antes = posiciones.current.get(clave)
      nuevas.set(clave, arriba)
      if (!reducido && antes !== undefined && antes !== arriba) {
        hijo.animate(
          [{ transform: `translateY(${antes - arriba}px)` }, { transform: 'none' }],
          { duration: 260, easing: 'ease-out' },
        )
      }
    }
    posiciones.current = nuevas
  }, [dep])

  return contenedor
}
