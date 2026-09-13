import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck } from 'lucide-react'
import * as api from '../lib/api'
import { usarDatos } from '../lib/usarDatos'
import { useClaveIdempotencia } from '../lib/idempotencia'
import { fecha as fechaLarga, hoyISO, mxn } from '../lib/formato'
import type {
  ConfirmacionCreate, MedioSalida, Pendiente, PendientesResponse,
  RecurrenteHistorial,
} from '../lib/tipos'
import Encabezado from '../componentes/Encabezado'
import Boton from '../componentes/Boton'
import Campo, { CampoSelect } from '../componentes/Campo'
import Cargando, { CargandoPanel } from '../componentes/Cargando'
import ErrorApi, { ErrorLinea } from '../componentes/ErrorApi'
import Modal from '../componentes/Modal'
import Vacio from '../componentes/Vacio'

/**
 * Lo que toca y aún no se ha confirmado.
 *
 * NO sale de ninguna tabla: el backend lo deriva cruzando lo que el usuario
 * declaró contra los movimientos que ya existen. Confirmar es lo que crea el
 * movimiento y mueve el saldo — hasta entonces nada de esto es un hecho.
 */
export default function Confirmar() {
  const cargar = useCallback(() => api.pendientes(), [])
  const { datos, error, cargando, recargar } = usarDatos(cargar)

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
  if (!datos) return <><Titulo /><ErrorApi error={error} reintentar={recargar} /></>

  return <Contenido datos={datos} alConfirmar={recargar} />
}

const Titulo = () => <Encabezado titulo="¿Qué ya pasó?" />

function Contenido({
  datos, alConfirmar,
}: { datos: PendientesResponse; alConfirmar: () => void }) {
  const [confirmando, setConfirmando] = useState<Pendiente | null>(null)

  const nada = datos.ingresos.length === 0 && datos.gastos.length === 0
  if (nada) {
    return (
      <>
        <Titulo />
        <Vacio
          icono={<CalendarCheck size={22} />}
          titulo="Estás al día"
          detalle="Ya confirmaste todo lo que tocaba este mes. Cuando se acerque el siguiente cobro, aparece aquí."
          accion={<Link to="/dashboard"><Boton tono="secundario">Ver tu resumen</Boton></Link>}
        />
      </>
    )
  }

  return (
    <>
      <Titulo />

      <div className="grid gap-3 sm:grid-cols-2">
        <Total etiqueta="Te falta cobrar" monto={datos.total_por_cobrar} />
        <Total etiqueta="Te falta pagar" monto={datos.total_por_pagar} />
      </div>

      <p className="text-12 text-tinta-suave mt-2">
        Nada de esto ha movido tu saldo todavía. Se mueve cuando lo confirmas.
      </p>

      <Grupo
        titulo="Lo que entra"
        filas={datos.ingresos}
        onConfirmar={setConfirmando}
      />
      <Grupo
        titulo="Lo que sale"
        filas={datos.gastos}
        onConfirmar={setConfirmando}
      />

      {confirmando && (
        <ModalConfirmar
          pendiente={confirmando}
          onCerrar={() => setConfirmando(null)}
          onHecho={() => { setConfirmando(null); alConfirmar() }}
        />
      )}
    </>
  )
}

function Total({ etiqueta, monto }: { etiqueta: string; monto: number }) {
  return (
    <div className="panel p-4">
      <p className="text-12 text-tinta-suave">{etiqueta}</p>
      <p className="cifra font-titulo text-32 font-semibold">{mxn(monto)}</p>
    </div>
  )
}

function Grupo({
  titulo, filas, onConfirmar,
}: { titulo: string; filas: Pendiente[]; onConfirmar: (p: Pendiente) => void }) {
  if (filas.length === 0) return null
  return (
    <section className="mt-5">
      <h2 className="font-titulo text-16 mb-2">{titulo}</h2>
      <div className="panel divide-y divide-linea">
        {[...filas]
          .sort((a, b) => a.dias_restantes - b.dias_restantes)
          .map(p => (
            // La fecha va en la clave: un ingreso quincenal produce DOS
            // pendientes con el mismo origen_id, uno por cada dia de pago.
            <Fila
              key={`${p.tipo}-${p.origen_id}-${p.fecha_esperada}`}
              p={p}
              onConfirmar={onConfirmar}
            />
          ))}
      </div>
    </section>
  )
}

/** "Hoy" / "Mañana" / "En 9 días" / "Hace 2 días". */
function cuando(dias: number): string {
  if (dias === 0) return 'Hoy'
  if (dias === 1) return 'Mañana'
  if (dias > 1) return `En ${dias} días`
  if (dias === -1) return 'Ayer'
  return `Hace ${Math.abs(dias)} días`
}

function Fila({ p, onConfirmar }: { p: Pendiente; onConfirmar: (p: Pendiente) => void }) {
  const vencido = p.dias_restantes < 0
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-14 truncate">{p.concepto}</p>
        <p className="text-12 text-tinta-suave">
          {cuando(p.dias_restantes)} · {fechaLarga(p.fecha_esperada)}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="cifra text-16 font-medium">{mxn(p.monto_esperado)}</p>
        {/* Es un variable: el monto que ves es una estimación, no un dato. */}
        {p.monto_incierto && (
          <p className="text-12 text-tinta-suave">aproximado</p>
        )}
      </div>
      <Boton
        tono={vencido ? 'primario' : 'secundario'}
        onClick={() => onConfirmar(p)}
      >
        Confirmar
      </Boton>
    </div>
  )
}

// ------------------------------------------------------------- el modal
function ModalConfirmar({
  pendiente, onCerrar, onHecho,
}: { pendiente: Pendiente; onCerrar: () => void; onHecho: () => void }) {
  const esIngreso = pendiente.tipo === 'ingreso'
  const { clave, gestoCompletado } = useClaveIdempotencia()

  const [monto, setMonto] = useState<string>(
    pendiente.monto_incierto ? '' : String(pendiente.monto_esperado),
  )
  const [fecha, setFecha] = useState(
    // Si la fecha esperada ya pasó, esa es la buena; si no, hoy.
    pendiente.dias_restantes <= 0 ? pendiente.fecha_esperada : hoyISO(),
  )
  const [medio, setMedio] = useState<MedioSalida>('debito')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const [historial, setHistorial] = useState<RecurrenteHistorial | null>(null)
  const [cargandoHistorial, setCargandoHistorial] = useState(pendiente.monto_incierto)

  // El rango real de un variable sale de sus últimos pagos, no de un min/max
  // guardado: nadie captura ese rango, y el que se captura envejece.
  useEffect(() => {
    if (!pendiente.monto_incierto || esIngreso) return
    let vivo = true
    api.historialRecurrente(pendiente.origen_id)
      .then(h => {
        if (!vivo) return
        setHistorial(h)
        // Se propone el MÁXIMO reciente, no el promedio: en una app que
        // previene deuda, quedarse corto es el error caro.
        setMonto(m => (m === '' ? String(h.monto_para_proyectar) : m))
      })
      .catch(() => { /* sin historial se captura a mano */ })
      .finally(() => { if (vivo) setCargandoHistorial(false) })
    return () => { vivo = false }
  }, [pendiente.origen_id, pendiente.monto_incierto, esIngreso])

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setAviso(null)

    if (pendiente.monto_incierto && !(Number(monto) > 0)) {
      setAviso(`¿De cuánto vino ${pendiente.concepto} este mes?`)
      return
    }

    const cuerpo: ConfirmacionCreate = {
      fecha,
      ...(monto !== '' ? { monto: Number(monto) } : {}),
      ...(esIngreso ? {} : { medio }),
    }

    setEnviando(true)
    try {
      if (esIngreso) {
        await api.confirmarIngreso(pendiente.origen_id, cuerpo, clave())
      } else {
        await api.confirmarRecurrente(pendiente.origen_id, cuerpo, clave())
      }
      gestoCompletado()
      onHecho()
    } catch (err) {
      setError(err)
      setEnviando(false)
    }
  }

  const rango = historial && historial.monto_min !== null && historial.monto_max !== null
    ? `Tus últimos ${historial.pagos_considerados} recibos: de ${mxn(historial.monto_min)} a ${mxn(historial.monto_max)}. Proponemos el más alto para no quedarnos cortos.`
    : null

  return (
    <Modal
      titulo={esIngreso ? `¿Ya te pagaron ${pendiente.concepto}?` : `¿Ya pagaste ${pendiente.concepto}?`}
      onCerrar={onCerrar}
    >
      <form onSubmit={enviar} className="space-y-4">
        {pendiente.monto_incierto && cargandoHistorial && (
          <Cargando className="h-4 w-2/3" />
        )}

        <Campo
          etiqueta={pendiente.monto_incierto ? '¿De cuánto vino?' : '¿De cuánto fue?'}
          type="number"
          min={0}
          step="any"
          prefijo="$"
          autoFocus={pendiente.monto_incierto}
          value={monto}
          onChange={e => setMonto(e.target.value)}
          ayuda={rango ?? (pendiente.monto_incierto ? 'Como viene en tu recibo' : undefined)}
        />

        <Campo
          etiqueta="¿Qué día?"
          type="date"
          max={hoyISO()}
          value={fecha}
          onChange={e => setFecha(e.target.value)}
        />

        {!esIngreso && (
          <CampoSelect
            etiqueta="¿De dónde salió?"
            value={medio}
            onChange={e => setMedio(e.target.value as MedioSalida)}
          >
            <option value="debito">De mi cuenta</option>
            <option value="efectivo">En efectivo</option>
          </CampoSelect>
        )}

        {aviso && <ErrorLinea error={new Error(aviso)} />}
        {error != null && <ErrorLinea error={error} />}

        <div className="flex gap-2 justify-end pt-1">
          <Boton type="button" tono="fantasma" onClick={onCerrar}>Todavía no</Boton>
          <Boton type="submit" tono="primario" cargando={enviando}>
            {esIngreso ? 'Ya me pagaron' : 'Ya lo pagué'}
          </Boton>
        </div>
      </form>
    </Modal>
  )
}
