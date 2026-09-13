import { useCallback, useState } from 'react'
import { CalendarClock, Plus, Trash2 } from 'lucide-react'
import * as api from '../lib/api'
import { usarDatos } from '../lib/usarDatos'
import { useCategorias } from '../lib/categorias'
import { diaDelMes, hoyISO, mxn } from '../lib/formato'
import {
  AJUSTES_MES_CORTO, FRECUENCIAS_MESES, periodicidad,
} from '../lib/ui-tipos'
import type {
  AjusteMesCorto, RecurrenteCreate, RecurrenteResumen,
} from '../lib/tipos'
import Encabezado from '../componentes/Encabezado'
import Boton from '../componentes/Boton'
import Campo, { CampoCheck, CampoSelect } from '../componentes/Campo'
import { CargandoPanel } from '../componentes/Cargando'
import ErrorApi, { ErrorLinea, camposConError } from '../componentes/ErrorApi'
import Modal from '../componentes/Modal'
import Vacio from '../componentes/Vacio'

export default function GastosFijos() {
  const cargar = useCallback(() => api.recurrentes(), [])
  const { datos, error, cargando, recargar } = usarDatos(cargar)

  const [editando, setEditando] = useState<RecurrenteResumen | 'nuevo' | null>(null)
  const [borrando, setBorrando] = useState<RecurrenteResumen | null>(null)

  const lista = datos?.data ?? []
  const total = lista
    .filter(r => r.activo)
    .reduce((a, r) => a + r.peso_mensual, 0)

  return (
    <>
      <Encabezado
        titulo="Lo que pagas siempre"
        accion={
          <Boton tono="primario" onClick={() => setEditando('nuevo')}>
            <Plus size={16} />
            Agregar
          </Boton>
        }
      />

      {cargando && !datos && <CargandoPanel lineas={4} />}
      {!cargando && !datos && <ErrorApi error={error} reintentar={recargar} />}

      {datos && lista.length === 0 && (
        <Vacio
          icono={<CalendarClock size={22} />}
          titulo="No tienes gastos fijos registrados"
          detalle="Renta, luz, internet, colegiaturas. Con esto sabemos cuánto de tu ingreso ya está comprometido antes de que gastes en nada más."
          accion={
            <Boton tono="primario" onClick={() => setEditando('nuevo')}>
              Agregar el primero
            </Boton>
          }
        />
      )}

      {datos && lista.length > 0 && (
        <>
          <section className="panel p-4 mb-4">
            <p className="text-12 text-tinta-suave">Se te va al mes, en promedio</p>
            <p className="cifra font-titulo text-32 font-semibold">{mxn(total)}</p>
            {/* peso_mensual viene AMORTIZADO: una luz de $900 bimestral pesa
                $450. Es la cifra de "cuánto de mi ingreso está comprometido" y
                la incorrecta para "¿me alcanza este mes?". */}
            <p className="text-12 text-tinta-suave mt-1">
              Los que no son mensuales están repartidos: un predial de $8,000 al
              año cuenta como $667 al mes. Para ver lo que cae completo este mes,
              mira <span className="text-tinta">¿Qué ya pasó?</span>
            </p>
          </section>

          <div className="panel divide-y divide-linea">
            {lista.map(r => (
              <Fila
                key={r.id}
                r={r}
                onEditar={() => setEditando(r)}
                onBorrar={() => setBorrando(r)}
              />
            ))}
          </div>
        </>
      )}

      {editando && (
        <ModalRecurrente
          recurrente={editando === 'nuevo' ? null : editando}
          onCerrar={() => setEditando(null)}
          onGuardado={() => { setEditando(null); recargar() }}
        />
      )}

      {borrando && (
        <ModalBorrar
          recurrente={borrando}
          onCerrar={() => setBorrando(null)}
          onHecho={() => { setBorrando(null); recargar() }}
        />
      )}
    </>
  )
}

function Fila({
  r, onEditar, onBorrar,
}: { r: RecurrenteResumen; onEditar: () => void; onBorrar: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <button
        type="button"
        onClick={onEditar}
        className="min-w-0 flex-1 text-left"
      >
        <p className="text-14 truncate">
          {r.concepto}
          {r.es_variable && (
            <span className="text-12 text-tinta-suave"> · el monto cambia</span>
          )}
        </p>
        <p className="text-12 text-tinta-suave truncate">
          {r.categoria_nombre} · {periodicidad(r.frecuencia_meses).toLowerCase()} ·{' '}
          {diaDelMes(r.dia_del_mes)}
        </p>
      </button>
      <div className="text-right shrink-0">
        <p className="cifra text-16 font-medium">{mxn(r.monto)}</p>
        {r.frecuencia_meses > 1 && (
          <p className="cifra text-12 text-tinta-suave">
            {mxn(r.peso_mensual)} al mes
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label={`Quitar ${r.concepto}`}
        onClick={onBorrar}
        className="text-tinta-suave hover:text-tinta p-3 -m-2 shrink-0"
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- el alta
interface Forma {
  concepto: string
  monto: string
  categoria: string
  dia_del_mes: string
  fecha_inicio: string
  frecuencia_meses: string
  es_variable: boolean
  ajuste_mes_corto: AjusteMesCorto
}

const desde = (r: RecurrenteResumen | null, claveInicial: string): Forma => r
  ? {
      concepto: r.concepto,
      monto: String(r.monto),
      categoria: r.categoria,
      dia_del_mes: String(r.dia_del_mes),
      fecha_inicio: r.fecha_inicio,
      frecuencia_meses: String(r.frecuencia_meses),
      es_variable: r.es_variable,
      ajuste_mes_corto: r.ajuste_mes_corto,
    }
  : {
      concepto: '', monto: '', categoria: claveInicial, dia_del_mes: '',
      fecha_inicio: hoyISO(), frecuencia_meses: '1', es_variable: false,
      ajuste_mes_corto: 'ultimo_dia',
    }

function ModalRecurrente({
  recurrente, onCerrar, onGuardado,
}: {
  recurrente: RecurrenteResumen | null
  onCerrar: () => void
  onGuardado: () => void
}) {
  const { categorias } = useCategorias()
  const [f, setF] = useState<Forma>(() => desde(recurrente, categorias[0]?.clave ?? 'otros'))
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const campos = camposConError(error)
  const editar = (cambio: Partial<Forma>) => setF(v => ({ ...v, ...cambio }))
  const periodico = Number(f.frecuencia_meses) > 1
  const diaDudoso = Number(f.dia_del_mes) > 28

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setAviso(null)

    if (!f.concepto.trim()) { setAviso('¿Cómo se llama este gasto?'); return }
    if (!(Number(f.monto) > 0)) { setAviso('¿De cuánto es?'); return }
    if (!f.dia_del_mes) { setAviso('¿Qué día del mes cae?'); return }
    if (!f.fecha_inicio) { setAviso('¿Desde cuándo lo pagas?'); return }

    const cuerpo: RecurrenteCreate = {
      concepto: f.concepto.trim(),
      monto: Number(f.monto),
      categoria: f.categoria,
      dia_del_mes: Number(f.dia_del_mes),
      fecha_inicio: f.fecha_inicio,
      frecuencia_meses: Number(f.frecuencia_meses),
      es_variable: f.es_variable,
      ajuste_mes_corto: f.ajuste_mes_corto,
    }

    setEnviando(true)
    try {
      if (recurrente) await api.actualizarRecurrente(recurrente.id, cuerpo)
      else await api.crearRecurrente(cuerpo)
      onGuardado()
    } catch (err) {
      setError(err)
      setEnviando(false)
    }
  }

  return (
    <Modal
      titulo={recurrente ? `Editar ${recurrente.concepto}` : 'Nuevo gasto fijo'}
      onCerrar={onCerrar}
    >
      <form onSubmit={enviar} className="space-y-4" noValidate>
        <Campo
          etiqueta="¿Qué es?"
          placeholder="Renta, luz, internet…"
          value={f.concepto}
          onChange={e => editar({ concepto: e.target.value })}
          error={campos.concepto}
        />

        <Campo
          etiqueta="¿Cuánto?"
          type="number" min={0} step="any" prefijo="$"
          value={f.monto}
          onChange={e => editar({ monto: e.target.value })}
          error={campos.monto}
          ayuda={f.es_variable ? 'Un aproximado; se ajusta con cada recibo' : undefined}
        />

        <CampoSelect
          etiqueta="Categoría"
          value={f.categoria}
          onChange={e => editar({ categoria: e.target.value })}
          error={campos.categoria}
        >
          {categorias.map(c => (
            <option key={c.clave} value={c.clave}>{c.nombre}</option>
          ))}
        </CampoSelect>

        <CampoSelect
          etiqueta="¿Cada cuánto llega?"
          value={f.frecuencia_meses}
          onChange={e => editar({ frecuencia_meses: e.target.value })}
          error={campos.frecuencia_meses}
        >
          {FRECUENCIAS_MESES.map(x => (
            <option key={x.valor} value={String(x.valor)}>{x.etiqueta}</option>
          ))}
        </CampoSelect>

        <Campo
          etiqueta="¿Qué día del mes cae?"
          type="number" min={1} max={31}
          value={f.dia_del_mes}
          onChange={e => editar({ dia_del_mes: e.target.value })}
          error={campos.dia_del_mes}
        />

        {diaDudoso && (
          <CampoSelect
            etiqueta="Si el mes no tiene ese día, ¿cuándo cae?"
            value={f.ajuste_mes_corto}
            onChange={e => editar({ ajuste_mes_corto: e.target.value as AjusteMesCorto })}
            ayuda="Febrero no tiene 30, y abril no tiene 31."
          >
            {AJUSTES_MES_CORTO.map(a => (
              <option key={a.valor} value={a.valor}>{a.etiqueta}</option>
            ))}
          </CampoSelect>
        )}

        {/* Define la FASE del ciclo, no es un dato administrativo: la luz
            bimestral de quien empezó en enero cae en meses nones. */}
        <Campo
          etiqueta="¿Desde cuándo lo pagas?"
          type="date"
          value={f.fecha_inicio}
          onChange={e => editar({ fecha_inicio: e.target.value })}
          error={campos.fecha_inicio}
          ayuda={periodico
            ? 'Con esto sabemos en qué meses cae, no solo cada cuánto.'
            : 'Desde cuándo lo vienes pagando.'}
        />

        <CampoCheck
          etiqueta="El monto cambia cada vez"
          ayuda="Luz, agua, gas. Antes de darlo por pagado te preguntamos de cuánto vino."
          checked={f.es_variable}
          onChange={e => editar({ es_variable: e.target.checked })}
        />

        {aviso && <ErrorLinea error={new Error(aviso)} />}
        {error != null && <ErrorLinea error={error} />}

        <div className="flex gap-2 justify-end pt-1">
          <Boton type="button" tono="fantasma" onClick={onCerrar}>Cancelar</Boton>
          <Boton type="submit" tono="primario" cargando={enviando}>Guardar</Boton>
        </div>
      </form>
    </Modal>
  )
}

function ModalBorrar({
  recurrente, onCerrar, onHecho,
}: { recurrente: RecurrenteResumen; onCerrar: () => void; onHecho: () => void }) {
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function borrar() {
    setEnviando(true)
    setError(null)
    try {
      await api.borrarRecurrente(recurrente.id)
      onHecho()
    } catch (e) {
      setError(e)
      setEnviando(false)
    }
  }

  return (
    <Modal titulo={`Quitar ${recurrente.concepto}`} onCerrar={onCerrar}>
      <p className="text-14 text-tinta-suave">
        Deja de contar en tus obligaciones y de aparecer para confirmar. Los
        pagos que ya registraste se quedan en tu historial.
      </p>
      {error != null && <div className="mt-3"><ErrorLinea error={error} /></div>}
      <div className="flex justify-end gap-2 mt-4">
        <Boton type="button" tono="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton type="button" tono="primario" cargando={enviando} onClick={borrar}>
          Quitar
        </Boton>
      </div>
    </Modal>
  )
}
