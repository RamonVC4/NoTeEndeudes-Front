import { useCallback, useState } from 'react'
import { ArrowDown, ArrowUp, Receipt, Trash2 } from 'lucide-react'
import * as api from '../lib/api'
import { usarDatos } from '../lib/usarDatos'
import { useCategorias } from '../lib/categorias'
import { useClaveIdempotencia } from '../lib/idempotencia'
import {
  fechaRelativa, haceUnAnoISO, hoyISO, mxn, NOMBRE_COMPONENTE,
} from '../lib/formato'
import { PLAZOS_COMUNES } from '../lib/tipos'
import type {
  Coleccion, Estado, MedioPago, MovimientoCreate, MovimientoResponse,
  MovimientoResumen, ScoreResponse, TarjetaEstado, TipoMovimiento,
} from '../lib/tipos'
import Encabezado from '../componentes/Encabezado'
import BarraComponente from '../componentes/BarraComponente'
import Boton from '../componentes/Boton'
import Campo, { CampoSelect } from '../componentes/Campo'
import { CargandoPanel } from '../componentes/Cargando'
import ErrorApi, { ErrorLinea, camposConError } from '../componentes/ErrorApi'
import Modal from '../componentes/Modal'
import Vacio from '../componentes/Vacio'

/**
 * Aquí solo se registran gastos e ingresos. Los pagos a tarjeta viven en
 * "Qué pagar primero" (Deuda), aunque el historial los sigue mostrando.
 */
type TipoRegistro = Exclude<TipoMovimiento, 'pago'>

/**
 * COMBINACIONES VÁLIDAS. Cualquier otra da 422, así que el formulario deriva
 * los medios del tipo en vez de dejar elegir y que el servidor lo rechace.
 *
 *   gasto   + efectivo/debito + SIN tarjeta  -> baja la liquidez
 *   gasto   + credito         + CON tarjeta  -> sube el saldo; la liquidez NO se toca
 *   ingreso + efectivo/debito + SIN tarjeta  -> sube la liquidez
 */
const MEDIOS_DE: Record<TipoRegistro, MedioPago[]> = {
  gasto: ['efectivo', 'debito', 'credito'],
  ingreso: ['efectivo', 'debito'],
}

const NOMBRE_MEDIO: Record<MedioPago, string> = {
  efectivo: 'Efectivo',
  debito: 'Débito',
  credito: 'Tarjeta de crédito',
}

/** Solo el gasto a crédito lleva tarjeta. */
const pideTarjeta = (tipo: TipoRegistro, medio: MedioPago) =>
  tipo === 'gasto' && medio === 'credito'

/** Algunas tarjetas llegan sin mínimo para meses: eso es "sin mínimo". */
const minimoMSI = (t: TarjetaEstado) => t.monto_minimo_msi ?? 0

export default function Movimientos() {
  const cargar = useCallback(
    () => Promise.all([api.movimientos(), api.estado(), api.score()]),
    [],
  )
  const { datos, error, cargando, recargar } = usarDatos(cargar)

  if (cargando && !datos) {
    return (
      <>
        <Titulo />
        <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[340px_minmax(0,1fr)]">
          <CargandoPanel lineas={5} />
          <CargandoPanel lineas={6} />
        </div>
      </>
    )
  }
  if (!datos) return <><Titulo /><ErrorApi error={error} reintentar={recargar} /></>

  const [pagina, estado, score] = datos
  return <Contenido pagina={pagina} estado={estado} score={score} alCambiar={recargar} />
}

const Titulo = () => <Encabezado titulo="Tus movimientos" />

function Contenido({
  pagina, estado, score, alCambiar,
}: {
  pagina: Coleccion<MovimientoResumen>
  estado: Estado
  score: ScoreResponse
  alCambiar: () => void
}) {
  const [ultimo, setUltimo] = useState<MovimientoResponse | null>(null)

  return (
    <>
      <Titulo />
      <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[340px_minmax(0,1fr)] items-start">
        {/* Sin sticky: con tarjeta y meses el formulario queda más alto que la
            ventana, y fijo dejaba los plazos y el botón fuera de alcance. */}
        <div className="space-y-4">
          <FormaMovimiento
            estado={estado}
            onHecho={r => { setUltimo(r); alCambiar() }}
          />
          {ultimo && <MicroMomento resultado={ultimo} pesos={score.pesos} />}
        </div>

        <Historial inicial={pagina} alBorrar={alCambiar} />
      </div>
    </>
  )
}

// ------------------------------------------------------- el micro-momento
function MicroMomento({
  resultado, pesos,
}: { resultado: MovimientoResponse; pesos: ScoreResponse['pesos'] }) {
  const { impacto, movimiento } = resultado

  // La clave de idempotencia ya se había usado: el movimiento existía y el
  // saldo NO se movió otra vez. Animar la barra diría lo contrario.
  if (resultado.repetido) {
    return (
      <section className="panel p-4" aria-live="polite">
        <p className="text-14 font-medium">Ya estaba registrado</p>
        <p className="text-12 text-tinta-suave mt-1">
          Este movimiento ya se había guardado, así que tu saldo no se movió otra
          vez.
        </p>
      </section>
    )
  }

  const c = impacto.componente_afectado
  return (
    <section className="panel p-4" aria-live="polite">
      <p className="text-14 font-medium">Registrado</p>
      <p className="text-12 text-tinta-suave mb-3">
        Esto le pasó a tu {NOMBRE_COMPONENTE[c].toLowerCase()}
      </p>
      {/* Se anima el COMPONENTE, no el score global: un gasto chico mueve
          menos de un punto entero y el score se vería igual. */}
      <BarraComponente
        key={movimiento.id}
        componente={c}
        valor={impacto.componente_despues}
        anterior={impacto.componente_antes}
        peso={pesos[c]}
        destacar
      />
    </section>
  )
}

// -------------------------------------------------------------- el alta
function FormaMovimiento({
  estado, onHecho,
}: { estado: Estado; onHecho: (r: MovimientoResponse) => void }) {
  const { categorias } = useCategorias()
  const { clave, gestoCompletado } = useClaveIdempotencia()

  const [tipo, setTipo] = useState<TipoRegistro>('gasto')
  const [medio, setMedio] = useState<MedioPago>('debito')
  const [monto, setMonto] = useState<number>(0)
  const [categoria, setCategoria] = useState<string>('')
  const [descripcion, setDescripcion] = useState('')
  const [fecha, setFecha] = useState(hoyISO())
  // Con una sola tarjeta no hay nada que elegir.
  const [tarjetaId, setTarjetaId] = useState<string>(
    estado.tarjetas.length === 1 ? estado.tarjetas[0].id : '',
  )
  const [conMSI, setConMSI] = useState(false)
  const [meses, setMeses] = useState(12)

  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const campos = camposConError(error)
  const sinTarjetas = estado.tarjetas.length === 0
  const conTarjeta = pideTarjeta(tipo, medio)
  // Tras una recarga la tarjeta elegida puede ya no estar: entonces no hay tarjeta.
  const tarjeta = conTarjeta ? estado.tarjetas.find(t => t.id === tarjetaId) ?? null : null
  const aMeses = conTarjeta && conMSI
  // El catálogo llega por red; hasta entonces el select está vacío y no hay
  // clave que mandar.
  const categoriaEfectiva = categoria || categorias[0]?.clave || ''

  /** Cambiar de tipo puede dejar el medio en una combinación inválida. */
  function cambiarTipo(t: TipoRegistro) {
    setTipo(t)
    setAviso(null)
    if (!MEDIOS_DE[t].includes(medio)) setMedio('debito')
    if (t !== 'gasto') setConMSI(false)
  }

  function cambiarMedio(m: MedioPago) {
    setMedio(m)
    setAviso(null)
    if (m !== 'credito') setConMSI(false)
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setAviso(null)

    if (!(monto > 0)) { setAviso('Escribe de cuánto fue'); return }
    if (conTarjeta && !tarjeta) { setAviso('Elige la tarjeta'); return }
    // Los mismos textos que redacta el servidor: el usuario lee lo mismo antes
    // y después de enviar.
    if (tarjeta && monto > tarjeta.disponible) {
      setAviso(`Excede tu linea disponible en ${tarjeta.nombre}`)
      return
    }
    if (tarjeta && aMeses && monto < minimoMSI(tarjeta)) {
      setAviso(`Los meses con esta tarjeta piden minimo ${mxn(minimoMSI(tarjeta))}`)
      return
    }
    if (tipo === 'gasto' && !categoriaEfectiva) { setAviso('Elige una categoría'); return }

    // `tarjeta_id` se OMITE cuando no toca: mandarlo en null también es 422.
    const cuerpo: MovimientoCreate = {
      tipo,
      medio,
      monto,
      fecha,
      ...(tipo === 'gasto' ? { categoria: categoriaEfectiva } : {}),
      ...(descripcion.trim() ? { descripcion: descripcion.trim() } : {}),
      ...(tarjeta ? { tarjeta_id: tarjeta.id } : {}),
      ...(aMeses ? { msi: { meses, descripcion: descripcion.trim() || undefined } } : {}),
    }

    setEnviando(true)
    try {
      const r = await api.registrarMovimiento(cuerpo, clave())
      gestoCompletado()
      onHecho(r)
      // Tipo, medio y tarjeta se quedan: se suelen capturar varias compras seguidas.
      setMonto(0)
      setDescripcion('')
      setConMSI(false)
    } catch (err) {
      setError(err)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="panel p-4 space-y-4" noValidate>
      <h2 className="font-titulo text-16">Registrar</h2>

      <div className="flex gap-1" role="group" aria-label="Tipo de movimiento">
        <Pestana activo={tipo === 'gasto'} onClick={() => cambiarTipo('gasto')}>
          Gasto
        </Pestana>
        <Pestana activo={tipo === 'ingreso'} onClick={() => cambiarTipo('ingreso')}>
          Ingreso
        </Pestana>
      </div>

      <Campo
        etiqueta="¿De cuánto?"
        type="number"
        min={0}
        step="any"
        prefijo="$"
        value={monto || ''}
        onChange={e => { setMonto(Number(e.target.value)); setAviso(null) }}
        error={campos.monto}
      />

      <div>
        <p className="etiqueta">{tipo === 'ingreso' ? '¿Cómo te llegó?' : '¿Con qué pagaste?'}</p>
        <div className="flex gap-1" role="group" aria-label="Medio de pago">
          {MEDIOS_DE[tipo].map(m => (
            <Pestana
              key={m}
              activo={medio === m}
              onClick={() => cambiarMedio(m)}
              deshabilitado={m === 'credito' && sinTarjetas}
            >
              {NOMBRE_MEDIO[m]}
            </Pestana>
          ))}
        </div>
        {tipo === 'gasto' && sinTarjetas && (
          <p className="text-12 text-tinta-suave mt-1">
            Da de alta una tarjeta en Tarjetas para registrar compras a crédito.
          </p>
        )}
        {conTarjeta && (
          <p className="text-12 text-tinta-suave mt-1">
            No sale dinero de tu bolsillo: sube lo que debes.
          </p>
        )}
      </div>

      {conTarjeta && (
        <CompraConTarjeta
          tarjetas={estado.tarjetas}
          tarjeta={tarjeta}
          onTarjeta={id => { setTarjetaId(id); setAviso(null) }}
          aMeses={conMSI}
          onAMeses={v => { setConMSI(v); setAviso(null) }}
          meses={meses}
          onMeses={setMeses}
          monto={monto}
          error={campos.tarjeta_id}
        />
      )}

      {tipo === 'gasto' && (
        <CampoSelect
          etiqueta="¿En qué?"
          value={categoriaEfectiva}
          onChange={e => setCategoria(e.target.value)}
          error={campos.categoria}
        >
          {categorias.map(c => (
            <option key={c.clave} value={c.clave}>{c.nombre}</option>
          ))}
        </CampoSelect>
      )}

      <Campo
        etiqueta="¿Qué fue?"
        placeholder={tipo === 'ingreso' ? 'Venta, préstamo…' : 'Comida del día…'}
        value={descripcion}
        onChange={e => setDescripcion(e.target.value)}
        error={campos.descripcion}
        ayuda="Opcional"
      />

      <Campo
        etiqueta="¿Cuándo?"
        type="date"
        min={haceUnAnoISO()}
        max={hoyISO()}
        value={fecha}
        onChange={e => setFecha(e.target.value)}
        error={campos.fecha}
      />

      {aviso && <ErrorLinea error={new Error(aviso)} />}
      {error != null && <ErrorLinea error={error} />}

      <Boton type="submit" tono="primario" className="w-full" cargando={enviando}>
        Registrar
      </Boton>
    </form>
  )
}

/**
 * La compra con tarjeta, en tres pasos: con cuál, cómo se pagó y, si fue a
 * meses, a cuántos.
 *
 * Los meses los define EL COMERCIO, no la tarjeta, y el saldo sube por el
 * TOTAL desde el día uno: el banco prestó los doce mil completos, y los "mil al
 * mes" son solo el permiso de pagarlo en doce. Modelarlo como +$1,000/mes le
 * diría al usuario que está mucho menos endeudado de lo que está.
 */
function CompraConTarjeta({
  tarjetas, tarjeta, onTarjeta, aMeses, onAMeses, meses, onMeses, monto, error,
}: {
  tarjetas: TarjetaEstado[]
  tarjeta: TarjetaEstado | null
  onTarjeta: (id: string) => void
  aMeses: boolean
  onAMeses: (v: boolean) => void
  meses: number
  onMeses: (m: number) => void
  monto: number
  error?: string | null
}) {
  const minimo = tarjeta ? minimoMSI(tarjeta) : 0

  return (
    <div className="border-t border-linea pt-3 space-y-4">
      <div>
        <p className="etiqueta">¿Con cuál tarjeta?</p>
        <div className="grid gap-1.5" role="group" aria-label="Tarjeta">
          {tarjetas.map(t => {
            const activa = tarjeta?.id === t.id
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={activa}
                onClick={() => onTarjeta(t.id)}
                className={[
                  'text-left rounded-md border px-3 py-2',
                  activa ? 'border-accion bg-papel' : 'border-linea hover:border-tinta-suave',
                ].join(' ')}
              >
                <span className={`block text-14 ${activa ? 'font-medium text-accion' : ''}`}>
                  {t.nombre}
                </span>
                <span className="block text-12 text-tinta-suave cifra">
                  Disponible {mxn(t.disponible)}
                  {minimoMSI(t) > 0 && ` · meses desde ${mxn(minimoMSI(t))}`}
                </span>
              </button>
            )
          })}
        </div>
        {error && <p className="text-12 mt-1" style={{ color: 'var(--rojo)' }}>{error}</p>}
        {tarjeta && monto > tarjeta.disponible && (
          <p className="text-12 mt-1" style={{ color: 'var(--rojo)' }}>
            Pasa de lo que te queda de línea ({mxn(tarjeta.disponible)}).
          </p>
        )}
      </div>

      {tarjeta && (
        <div>
          <p className="etiqueta">¿Cómo lo pagaste?</p>
          <div className="flex gap-1" role="group" aria-label="Forma de pago">
            <Pestana activo={!aMeses} onClick={() => onAMeses(false)}>
              Un solo pago
            </Pestana>
            <Pestana activo={aMeses} onClick={() => onAMeses(true)}>
              A meses sin intereses
            </Pestana>
          </div>
        </div>
      )}

      {tarjeta && aMeses && (
        <div>
          <p className="etiqueta">¿A cuántos meses?</p>
          <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Plazo">
            {PLAZOS_COMUNES.map(m => (
              <button
                key={m}
                type="button"
                aria-pressed={meses === m}
                onClick={() => onMeses(m)}
                className={[
                  'cifra text-14 px-3 py-1.5 rounded-full border',
                  meses === m
                    ? 'border-accion text-accion font-medium'
                    : 'border-linea text-tinta-suave hover:border-tinta-suave',
                ].join(' ')}
              >
                {m}
              </button>
            ))}
          </div>
          {monto > 0 && monto < minimo ? (
            <p className="text-12 mt-2" style={{ color: 'var(--rojo)' }}>
              A meses, {tarjeta.nombre} pide mínimo {mxn(minimo)}.
            </p>
          ) : (
            <p className="text-12 text-tinta-suave mt-2">
              {monto > 0
                ? `Pagas ${mxn(Math.round(monto / meses))} al mes, pero lo que debes sube ${mxn(monto)} hoy.`
                : 'Lo que debes sube por el total desde hoy, no por la mensualidad.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Pestana({
  activo, onClick, deshabilitado = false, children,
}: {
  activo: boolean; onClick: () => void; deshabilitado?: boolean; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      disabled={deshabilitado}
      onClick={onClick}
      className={[
        'text-14 px-3 py-1.5 rounded-md flex-1 disabled:opacity-40',
        activo ? 'bg-papel font-medium' : 'text-tinta-suave hover:text-tinta',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// ----------------------------------------------------------- el historial
function Historial({
  inicial, alBorrar,
}: { inicial: Coleccion<MovimientoResumen>; alBorrar: () => void }) {
  const [base, setBase] = useState(inicial)
  const [extra, setExtra] = useState<MovimientoResumen[]>([])
  const [cursor, setCursor] = useState(inicial.meta.siguiente_cursor)
  const [hayMas, setHayMas] = useState(inicial.meta.hay_mas)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [errorMas, setErrorMas] = useState<unknown>(null)
  const [borrando, setBorrando] = useState<MovimientoResumen | null>(null)

  // Llegó una recarga (se registró o se borró algo): las páginas que veníamos
  // acumulando ya no corresponden a esta lista.
  if (inicial !== base) {
    setBase(inicial)
    setExtra([])
    setCursor(inicial.meta.siguiente_cursor)
    setHayMas(inicial.meta.hay_mas)
    setErrorMas(null)
  }

  async function verMas() {
    setCargandoMas(true)
    setErrorMas(null)
    try {
      // El cursor es opaco: se devuelve tal cual, sin interpretarlo.
      const r = await api.movimientos({ cursor })
      setExtra(e => [...e, ...r.data])
      setCursor(r.meta.siguiente_cursor)
      setHayMas(r.meta.hay_mas)
    } catch (e) {
      setErrorMas(e)
    } finally {
      setCargandoMas(false)
    }
  }

  const lista = [...inicial.data, ...extra]

  if (lista.length === 0) {
    return (
      <Vacio
        icono={<Receipt size={22} />}
        titulo="Aún no registras nada"
        detalle="Cada gasto que anotes hace tu score más realista. Empieza con el de hoy."
      />
    )
  }

  const grupos = new Map<string, MovimientoResumen[]>()
  for (const m of lista) {
    const previos = grupos.get(m.fecha)
    if (previos) previos.push(m)
    else grupos.set(m.fecha, [m])
  }

  return (
    <section className="space-y-4" aria-label="Historial">
      {[...grupos.entries()].map(([fecha, movs]) => (
        <div key={fecha}>
          <h2 className="text-12 text-tinta-suave mb-1.5">{fechaRelativa(fecha)}</h2>
          <div className="panel divide-y divide-linea">
            {movs.map(m => (
              <Fila key={m.id} mov={m} onBorrar={() => setBorrando(m)} />
            ))}
          </div>
        </div>
      ))}

      {errorMas != null && <ErrorLinea error={errorMas} />}

      {hayMas && (
        <Boton tono="secundario" className="w-full" cargando={cargandoMas} onClick={verMas}>
          Ver más
        </Boton>
      )}

      {borrando && (
        <ModalBorrar
          mov={borrando}
          onCerrar={() => setBorrando(null)}
          onHecho={() => { setBorrando(null); alBorrar() }}
        />
      )}
    </section>
  )
}

function Fila({
  mov, onBorrar,
}: { mov: MovimientoResumen; onBorrar: () => void }) {
  const entra = mov.tipo === 'ingreso'
  const Icono = entra ? ArrowUp : ArrowDown

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Icono size={15} className="text-tinta-suave shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-14 truncate">
          {mov.descripcion ?? mov.categoria_nombre ?? etiquetaTipo(mov.tipo)}
        </p>
        <p className="text-12 text-tinta-suave truncate">
          {[
            mov.categoria_nombre && mov.descripcion ? mov.categoria_nombre : null,
            mov.tarjeta_nombre ?? NOMBRE_MEDIO[mov.medio],
          ].filter(Boolean).join(' · ')}
        </p>
      </div>
      <p className="cifra text-16 font-medium shrink-0">
        {entra ? '+' : '−'}{mxn(mov.monto)}
      </p>
      <button
        type="button"
        aria-label={`Borrar ${mov.descripcion ?? etiquetaTipo(mov.tipo)}`}
        onClick={onBorrar}
        className="text-tinta-suave hover:text-tinta p-3 -m-2 shrink-0"
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}

/**
 * El motivo es obligatorio y el borrado REVIERTE el saldo en la misma
 * transacción. Un borrado que no revierte es peor que no borrar: el dato
 * desaparece de la vista pero el saldo sigue movido.
 */
function ModalBorrar({
  mov, onCerrar, onHecho,
}: { mov: MovimientoResumen; onCerrar: () => void; onHecho: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setError(null)
    try {
      await api.borrarMovimiento(mov.id, motivo.trim() || 'capturado por error')
      onHecho()
    } catch (err) {
      setError(err)
      setEnviando(false)
    }
  }

  return (
    <Modal titulo="Borrar movimiento" onCerrar={onCerrar}>
      <form onSubmit={enviar} className="space-y-4">
        <p className="text-14 text-tinta-suave">
          Se va {mxn(mov.monto)} de tu historial y tu saldo vuelve a como estaba
          antes de registrarlo.
        </p>

        <Campo
          etiqueta="¿Por qué lo borras?"
          placeholder="Capturado por error"
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
          ayuda="Queda anotado, para poder rastrear el cambio después."
        />

        {error != null && <ErrorLinea error={error} />}

        <div className="flex gap-2 justify-end pt-1">
          <Boton type="button" tono="fantasma" onClick={onCerrar}>Cancelar</Boton>
          <Boton type="submit" tono="primario" cargando={enviando}>Borrar</Boton>
        </div>
      </form>
    </Modal>
  )
}

const etiquetaTipo = (t: MovimientoResumen['tipo']) =>
  t === 'pago' ? 'Pago a tarjeta' : t === 'ingreso' ? 'Ingreso' : 'Gasto'
