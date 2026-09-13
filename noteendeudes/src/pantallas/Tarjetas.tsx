import { useCallback, useRef, useState } from 'react'
import {
  CalendarRange, CreditCard, FileText, Plus, Sparkles, Trash2, TriangleAlert,
} from 'lucide-react'
import * as api from '../lib/api'
import { ApiException } from '../lib/api'
import { usarDatos } from '../lib/usarDatos'
import { extraerEstadoDeCuenta } from '../lib/ia'
import { fecha as fechaLarga, hoyISO, mxn, pct, pctYa } from '../lib/formato'
import {
  AYUDA_PAGO, ETIQUETA_PAGO, etiquetaEnFicha, guardarModo, modoDe,
} from '../lib/pagoTarjeta'
import type { ModoPago } from '../lib/pagoTarjeta'
import type {
  MSICreate, MSIResumen, PagosLeidos, PeriodoCreate, PeriodoResumen,
  TarjetaResumen, TarjetaUpdate, TipoTarjeta,
} from '../lib/tipos'
import Encabezado from '../componentes/Encabezado'
import Boton from '../componentes/Boton'
import Campo, { CampoSelect } from '../componentes/Campo'
import { CargandoPanel } from '../componentes/Cargando'
import ErrorApi, { ErrorLinea, camposConError } from '../componentes/ErrorApi'
import Modal from '../componentes/Modal'
import Vacio from '../componentes/Vacio'

// El cargador debe permanecer visible aunque falte la configuración del lector.
const hayLectorPdf = () => true

export default function Tarjetas() {
  const cargar = useCallback(() => api.tarjetas(), [])
  const { datos, error, cargando, recargar } = usarDatos(cargar)

  const [alta, setAlta] = useState(false)
  const [editando, setEditando] = useState<TarjetaResumen | null>(null)
  const [borrando, setBorrando] = useState<TarjetaResumen | null>(null)
  const [cortes, setCortes] = useState<TarjetaResumen | null>(null)

  return (
    <>
      <Encabezado
        titulo="Tus tarjetas"
        accion={
          <Boton tono="primario" onClick={() => setAlta(true)}>
            <Plus size={16} />
            Agregar
          </Boton>
        }
      />

      {cargando && !datos && <div className="space-y-3"><CargandoPanel lineas={3} /></div>}
      {!cargando && !datos && <ErrorApi error={error} reintentar={recargar} />}

      {datos && datos.data.length === 0 && (
        <Vacio
          icono={<CreditCard size={22} />}
          titulo="Aún no registras tarjetas"
          detalle="Con los datos de tu estado de cuenta podemos decirte qué te conviene."
          accion={<Boton tono="primario" onClick={() => setAlta(true)}>Agregar tarjeta</Boton>}
        />
      )}

      {datos && datos.data.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {datos.data.map(t => (
            <Ficha
              key={t.id}
              tarjeta={t}
              onCompletar={() => setEditando(t)}
              onBorrar={() => setBorrando(t)}
              onCortes={() => setCortes(t)}
            />
          ))}
        </div>
      )}

      <p className="text-12 text-tinta-suave mt-5">
        Nunca te pedimos el número de tu tarjeta. No lo guardamos ni lo mandamos
        a ningún lado.
      </p>

      {alta && (
        <ModalAlta
          onCerrar={() => setAlta(false)}
          onCreada={creada => {
            setAlta(false)
            recargar()
            // POST /tarjetas devuelve el recurso completo: ya no hay que
            // fabricar un TarjetaResumen a mano para abrir el editor.
            if (creada.requiere_terminos) setEditando(creada)
          }}
        />
      )}

      {cortes && (
        <ModalCortes tarjeta={cortes} onCerrar={() => setCortes(null)} />
      )}

      {borrando && (
        <ModalBorrarTarjeta
          tarjeta={borrando}
          onCerrar={() => setBorrando(null)}
          onHecho={() => { setBorrando(null); recargar() }}
        />
      )}

      {editando && (
        <EditorTerminos
          tarjeta={editando}
          onCerrar={() => setEditando(null)}
          onGuardada={() => { setEditando(null); recargar() }}
        />
      )}
    </>
  )
}

// ----------------------------------------------------------------- ficha
function Ficha({
  tarjeta, onCompletar, onBorrar, onCortes,
}: {
  tarjeta: TarjetaResumen
  onCompletar: () => void
  onBorrar: () => void
  onCortes: () => void
}) {
  if (tarjeta.requiere_terminos) {
    return (
      <article className="panel p-4" style={{ borderColor: 'var(--ambar)' }}>
        <div className="flex items-start gap-3">
          <TriangleAlert size={18} style={{ color: 'var(--ambar)' }} className="shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h2 className="text-16 font-medium truncate">{tarjeta.nombre}</h2>
            <p className="text-14 text-tinta-suave mt-1">
              Le faltan sus datos. Sin límite, saldo y tasa no entra a los cálculos.
            </p>
            <Boton tono="primario" className="mt-3" onClick={onCompletar}>
              Completar datos
            </Boton>
          </div>
        </div>
      </article>
    )
  }

  if (tarjeta.tipo === 'debito') {
    return (
      <article className="panel p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-16 font-medium truncate">{tarjeta.nombre}</h2>
          <span className="text-12 text-tinta-suave">Débito</span>
        </div>
        <p className="text-14 text-tinta-suave mt-1">
          Los gastos con esta tarjeta salen de tu dinero disponible.
        </p>
      </article>
    )
  }

  const limite = tarjeta.limite ?? 0
  const saldo = tarjeta.saldo ?? 0
  const uso = limite > 0 ? (saldo / limite) * 100 : 0
  const modo = modoDe(tarjeta.id)

  return (
    <article className="panel p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-16 font-medium truncate">{tarjeta.nombre}</h2>
        <span className="cifra text-12 text-tinta-suave">{pctYa(uso)} usado</span>
      </div>

      <div className="h-1 rounded-full mt-2 overflow-hidden" style={{ background: 'var(--linea)' }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, uso)}%`, background: 'var(--tinta-suave)' }}
        />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4">
        <Dato etiqueta="Debes" valor={mxn(saldo)} />
        <Dato etiqueta="Puedes usar" valor={mxn(tarjeta.disponible)} />
        <Dato etiqueta="Tasa anual" valor={pct(tarjeta.tasa_anual)} />
        <Dato etiqueta={etiquetaEnFicha(modo)} valor={mxn(tarjeta.pago_minimo)} />
        <Dato etiqueta="Corta el día" valor={String(tarjeta.dia_corte ?? '—')} />
        <Dato etiqueta="Pagas antes del" valor={String(tarjeta.dia_limite_pago ?? '—')} />
      </dl>

      <p className="text-12 text-tinta-suave mt-3">
        Ese pago baja lo que ya debes, no es un gasto aparte.
      </p>

      {tarjeta.msi.length > 0 && (
        <div className="mt-4 pt-3 border-t border-linea">
          <p className="text-12 text-tinta-suave mb-1.5">Compras a meses</p>
          <ul className="space-y-2">
            {tarjeta.msi.map(m => (
              <li key={m.id} className="text-14">
                <div className="flex justify-between gap-3">
                  <span className="truncate">{m.descripcion ?? 'Compra a meses'}</span>
                  {/* El saldo pendiente es la verdad de la deuda; la
                      mensualidad solo dice como se paga. */}
                  <span className="cifra shrink-0">{mxn(m.saldo_pendiente)}</span>
                </div>
                <p className="text-12 text-tinta-suave">
                  {mxn(m.monto_mensual)} al mes · le faltan {m.meses_restantes} de {m.meses_totales}
                  {m.movimiento_id === null && ' · de tu estado de cuenta'}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2 mt-4">
        <Boton tono="secundario" onClick={onCompletar}>
          Actualizar datos
        </Boton>
        <Boton tono="fantasma" onClick={onCortes}>
          <CalendarRange size={16} />
          Cortes
        </Boton>
        <button
          type="button"
          aria-label={`Quitar ${tarjeta.nombre}`}
          onClick={onBorrar}
          className="text-tinta-suave hover:text-tinta p-2 ml-auto"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </article>
  )
}

/**
 * Baja logica. Los movimientos que la referencian se quedan como estaban: con
 * un borrado en cascada, quitar una tarjeta reescribiria sus gastos a credito
 * como si hubieran sido en efectivo y cambiaria la liquidez calculada del
 * pasado.
 */
function ModalBorrarTarjeta({
  tarjeta, onCerrar, onHecho,
}: { tarjeta: TarjetaResumen; onCerrar: () => void; onHecho: () => void }) {
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function borrar() {
    setEnviando(true)
    setError(null)
    try {
      await api.borrarTarjeta(tarjeta.id)
      onHecho()
    } catch (e) {
      setError(e)
      setEnviando(false)
    }
  }

  return (
    <Modal titulo={`Quitar ${tarjeta.nombre}`} onCerrar={onCerrar}>
      <p className="text-14 text-tinta-suave">
        Deja de contar para tu score y tu simulador. Los movimientos que ya
        registraste con ella se quedan en tu historial tal como están.
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

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-12 text-tinta-suave">{etiqueta}</dt>
      <dd className="cifra text-14 font-medium">{valor}</dd>
    </div>
  )
}

// ------------------------------------------------------------ alta paso 1
function ModalAlta({
  onCerrar, onCreada,
}: {
  onCerrar: () => void
  onCreada: (creada: TarjetaResumen) => void
}) {
  const [banco, setBanco] = useState('')
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState<TipoTarjeta>('credito')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const campos = camposConError(error)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!banco.trim()) { setError(new Error('Escribe el banco')); return }
    setEnviando(true)
    setError(null)
    const cuerpo = { banco: banco.trim(), nombre: nombre.trim() || banco.trim(), tipo }
    try {
      onCreada(await api.crearTarjeta(cuerpo))
    } catch (err) {
      setError(err)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo="Agregar tarjeta" onCerrar={onCerrar}>
      <form onSubmit={enviar} className="space-y-4" noValidate>
        <Campo
          etiqueta="Banco"
          placeholder="BBVA, NU, Santander…"
          value={banco}
          onChange={e => setBanco(e.target.value)}
          error={campos.banco}
        />
        <Campo
          etiqueta="¿Cómo le dices?"
          placeholder="Opcional"
          value={nombre}
          onChange={e => setNombre(e.target.value)}
          ayuda="Si lo dejas vacío usamos el nombre del banco"
          error={campos.nombre}
        />
        <CampoSelect
          etiqueta="Tipo"
          value={tipo}
          onChange={e => setTipo(e.target.value as TipoTarjeta)}
        >
          <option value="credito">Crédito</option>
          <option value="debito">Débito</option>
        </CampoSelect>

        {error != null && <ErrorLinea error={error} />}

        <div className="flex justify-end gap-2">
          <Boton type="button" tono="fantasma" onClick={onCerrar}>Cancelar</Boton>
          <Boton type="submit" tono="primario" cargando={enviando}>
            {tipo === 'credito' ? 'Continuar' : 'Guardar'}
          </Boton>
        </div>
      </form>
    </Modal>
  )
}

// ------------------------------------------------------------ alta paso 2
interface FormaTerminos {
  // Se captura el DISPONIBLE, no el saldo: es el numero que viene impreso y el
  // que el usuario reconoce. El saldo sale de la resta.
  limite: string; disponible: string; tasa_pct: string; pago: string
  dia_corte: string; dia_limite_pago: string; monto_minimo_msi: string
}

const desdeTarjeta = (t: TarjetaResumen): FormaTerminos => ({
  limite: t.limite?.toString() ?? '',
  disponible: t.disponible?.toString() ?? '',
  tasa_pct: t.tasa_anual !== null ? String(t.tasa_anual * 100) : '',
  pago: t.pago_minimo?.toString() ?? '',
  dia_corte: t.dia_corte?.toString() ?? '',
  dia_limite_pago: t.dia_limite_pago?.toString() ?? '',
  monto_minimo_msi: t.monto_minimo_msi?.toString() ?? '',
})

/**
 * Una fila de la lista de planes a meses.
 *
 * Con `id` ya existe en el backend y solo se puede quitar (DELETE /msi/{id});
 * sin `id` es nueva y se da de alta al guardar (POST /msi). No van dentro del
 * PATCH de la tarjeta: guardarlos con los terminos obligaba a borrar la lista
 * entera para reinsertarla, y eso destruye el vinculo de un plan con la compra
 * que lo origino.
 */
interface FilaPlan {
  id: string | null
  descripcion: string
  monto_mensual: string
  meses_totales: string
  meses_restantes: string
  fecha_inicio: string
}

const planExistente = (m: MSIResumen): FilaPlan => ({
  id: m.id,
  descripcion: m.descripcion ?? '',
  monto_mensual: String(m.monto_mensual),
  meses_totales: String(m.meses_totales),
  meses_restantes: String(m.meses_restantes),
  fecha_inicio: m.fecha_inicio,
})

/** Cuando empezo un plan, contando hacia atras. El backend deriva al reves. */
function inicioDePlan(mesesTotales: string, mesesRestantes: string): string {
  const t = Number(mesesTotales)
  const r = Number(mesesRestantes)
  if (!(t > 0) || !(r >= 0) || r > t) return hoyISO()
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - (t - r))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

type EstadoPdf = 'inactivo' | 'leyendo' | 'listo'

function EditorTerminos({
  tarjeta, onCerrar, onGuardada,
}: { tarjeta: TarjetaResumen; onCerrar: () => void; onGuardada: () => void }) {
  const [forma, setForma] = useState<FormaTerminos>(() => desdeTarjeta(tarjeta))
  const [modo, setModo] = useState<ModoPago>(() => modoDe(tarjeta.id) ?? 'minimo')
  const [pagosPdf, setPagosPdf] = useState<PagosLeidos | null>(null)
  const [planes, setPlanes] = useState<FilaPlan[]>(
    () => (tarjeta.msi ?? []).map(planExistente),
  )
  // La version con la que se abrio el formulario. Si el backend responde 409,
  // aqui entra la fresca y el usuario decide si vuelve a guardar.
  const [version, setVersion] = useState(tarjeta.version)
  const [conflicto, setConflicto] = useState<TarjetaResumen | null>(null)
  const [deIA, setDeIA] = useState<Set<string>>(new Set())
  const [avisos, setAvisos] = useState<string[]>([])
  const [confianza, setConfianza] = useState<'alta' | 'media' | 'baja' | null>(null)
  const [estadoPdf, setEstadoPdf] = useState<EstadoPdf>('inactivo')
  const [errorPdf, setErrorPdf] = useState<string | null>(null)
  const [arrastrando, setArrastrando] = useState(false)

  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const entrada = useRef<HTMLInputElement>(null)

  const campos = camposConError(error)

  // Lo que debes es el resto: asi el disponible de la app es el impreso.
  const debes = forma.limite !== '' && forma.disponible !== ''
    ? Math.round((Number(forma.limite) - Number(forma.disponible)) * 100) / 100
    : null

  function cambiarModo(nuevo: ModoPago) {
    if (nuevo === modo) return
    setModo(nuevo)
    // El pago minimo y el total para no generar intereses son numeros
    // distintos: al cambiar de modo no se puede dejar el anterior bajo la
    // etiqueta nueva. Si el PDF traia el otro, se usa; si no, se vacia.
    const delPdf = nuevo === 'total' ? pagosPdf?.sin_intereses : pagosPdf?.minimo
    setForma(f => ({ ...f, pago: delPdf != null ? String(delPdf) : '' }))
    setDeIA(prev => {
      const s = new Set(prev)
      if (delPdf != null) s.add('pago')
      else s.delete('pago')
      return s
    })
  }

  const editar = (cambio: Partial<FormaTerminos>) => {
    setForma(f => ({ ...f, ...cambio }))
    // En cuanto el usuario toca un campo deja de ser "de tu PDF".
    setDeIA(prev => {
      const s = new Set(prev)
      for (const k of Object.keys(cambio)) s.delete(k)
      return s
    })
  }

  async function leerPdf(archivo: File) {
    setEstadoPdf('leyendo')
    setErrorPdf(null)
    setAvisos([])
    setConfianza(null)
    try {
      // El backend lee el PDF, normaliza los numeros y redacta los avisos. Aqui
      // solo se reparte lo que llega entre los campos del formulario.
      // `modo` viaja para que prellene el pago que corresponde.
      const r = await extraerEstadoDeCuenta(tarjeta.id, archivo, modo)
      const v = r.valores

      // Los dos pagos se guardan para que cambiar de modo no vuelva a subir el PDF.
      setPagosPdf(r.pagos)

      // Nada de esto se guarda: solo prellena el formulario.
      setForma(f => ({
        ...f,
        limite: v.limite !== undefined ? String(v.limite) : f.limite,
        disponible: r.disponible !== null ? String(r.disponible) : f.disponible,
        tasa_pct: v.tasa_anual !== undefined ? String(v.tasa_anual * 100) : f.tasa_pct,
        pago: v.pago_minimo !== undefined ? String(v.pago_minimo) : f.pago,
        dia_corte: v.dia_corte !== undefined ? String(v.dia_corte) : f.dia_corte,
        dia_limite_pago: v.dia_limite_pago !== undefined
          ? String(v.dia_limite_pago) : f.dia_limite_pago,
        // El estado de cuenta nunca trae este dato: siempre queda manual.
        monto_minimo_msi: f.monto_minimo_msi,
      }))
      if (r.planes.length > 0) {
        setPlanes(p => [...p, ...r.planes.map(pl => ({
          id: null,
          descripcion: pl.descripcion ?? '',
          monto_mensual: String(pl.monto_mensual),
          // El estado de cuenta no imprime a cuantos meses fue la compra:
          // ese campo se queda para que lo escriba el usuario.
          meses_totales: '',
          meses_restantes: String(pl.meses_restantes),
          fecha_inicio: '',
        }))])
      }

      // `campos_ia` ya viene con los nombres del formulario, y el aviso de
      // "este PDF es de otro banco" ya viene redactado dentro de `avisos`.
      setDeIA(new Set(r.campos_ia))
      setAvisos(r.avisos)
      setConfianza(r.confianza)
      setEstadoPdf('listo')
    } catch (e) {
      // Si falla, el formulario queda vacío y se captura a mano.
      setErrorPdf(e instanceof Error ? e.message : 'No se pudo leer el PDF')
      setEstadoPdf('inactivo')
    }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setAviso(null)

    const n = (s: string) => Number(s)
    if (!(n(forma.limite) > 0)) { setAviso('Falta el límite de crédito'); return }
    if (forma.disponible.trim() === '' || n(forma.disponible) < 0) {
      setAviso('Falta tu crédito disponible'); return
    }
    if (n(forma.disponible) > n(forma.limite)) {
      setAviso('El crédito disponible no puede pasar del límite'); return
    }
    if (!(n(forma.tasa_pct) > 0)) { setAviso('Falta la tasa anual'); return }
    if (!forma.dia_corte || !forma.dia_limite_pago) { setAviso('Faltan las fechas de corte y pago'); return }
    if (n(forma.dia_corte) === n(forma.dia_limite_pago)) {
      setAviso('El día de corte y el día límite de pago no pueden ser el mismo')
      return
    }

    // PATCH parcial mas `version`. Si alguien registro un gasto mientras el
    // formulario estaba abierto, la version ya no coincide y el backend
    // responde 409 en vez de dejar que este guardado lo pise en silencio.
    const cuerpo: TarjetaUpdate = {
      limite: n(forma.limite),
      // El backend calcula disponible = limite - saldo. Derivandolo al reves,
      // el disponible que ve el usuario cuadra con el de su estado de cuenta.
      saldo: Math.round((n(forma.limite) - n(forma.disponible)) * 100) / 100,
      tasa_anual: n(forma.tasa_pct) / 100,
      pago_minimo: forma.pago ? n(forma.pago) : 0,
      dia_corte: n(forma.dia_corte),
      dia_limite_pago: n(forma.dia_limite_pago),
      monto_minimo_msi: forma.monto_minimo_msi ? n(forma.monto_minimo_msi) : 0,
      version,
    }

    setEnviando(true)
    try {
      await api.actualizarTarjeta(tarjeta.id, cuerpo)
      setConflicto(null)
      // El contrato no tiene donde anotar QUE significa el pago: se recuerda aqui.
      guardarModo(tarjeta.id, modo)
      await sincronizarPlanes()
      onGuardada()
    } catch (err) {
      if (err instanceof ApiException && err.status === 409) {
        // Se relee para poder decirle al usuario QUE cambio, no solo que fallo.
        try {
          const fresca = await api.tarjeta(tarjeta.id)
          setConflicto(fresca)
          setVersion(fresca.version)
        } catch {
          setVersion(err.versionActual ?? version)
        }
      }
      setError(err)
    } finally {
      setEnviando(false)
    }
  }

  /**
   * Los planes a meses viven fuera del PATCH: los nuevos se crean y los que el
   * usuario quito se borran. Si uno falla no se tumba el guardado de los
   * terminos, que es lo que de verdad mueve el score.
   */
  async function sincronizarPlanes() {
    const vivos = new Set(planes.map(p => p.id).filter(Boolean))
    const fallos: string[] = []

    for (const previo of tarjeta.msi ?? []) {
      if (vivos.has(previo.id)) continue
      try { await api.borrarMSI(previo.id) } catch { fallos.push('quitar') }
    }

    for (const p of planes) {
      if (p.id !== null) continue
      if (!(Number(p.monto_mensual) > 0) || !(Number(p.meses_totales) > 0)) continue
      const nuevo: MSICreate = {
        tarjeta_id: tarjeta.id,
        monto_mensual: Number(p.monto_mensual),
        meses_totales: Number(p.meses_totales),
        meses_restantes: Number(p.meses_restantes),
        fecha_inicio: p.fecha_inicio || inicioDePlan(p.meses_totales, p.meses_restantes),
        ...(p.descripcion.trim() ? { descripcion: p.descripcion.trim() } : {}),
      }
      try { await api.crearMSI(nuevo) } catch { fallos.push('agregar') }
    }

    if (fallos.length > 0) {
      setAviso(`Se guardaron los datos, pero no se pudo ${fallos[0]} ${fallos.length} compra(s) a meses.`)
    }
  }

  return (
    <Modal titulo={`Datos de ${tarjeta.nombre}`} onCerrar={onCerrar}>
      {hayLectorPdf() && (
        <section className="mb-5">
          <div
            onDragOver={e => { e.preventDefault(); setArrastrando(true) }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={e => {
              e.preventDefault()
              setArrastrando(false)
              const f = e.dataTransfer.files?.[0]
              if (f) leerPdf(f)
            }}
            className="border border-dashed rounded-lg p-4 text-center"
            style={{ borderColor: arrastrando ? 'var(--accion)' : 'var(--linea)' }}
          >
            {estadoPdf === 'leyendo' ? (
              <p className="text-14 flex items-center justify-center gap-2">
                <Sparkles size={16} className="animate-pulse" />
                Leyendo tu estado de cuenta…
              </p>
            ) : (
              <>
                <FileText size={20} className="mx-auto text-tinta-suave" />
                <p className="text-14 mt-2">
                  Arrastra el PDF de tu estado de cuenta y llenamos esto por ti
                </p>
                <input
                  ref={entrada}
                  type="file"
                  accept="application/pdf"
                  className="sr-only"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) leerPdf(f)
                    e.target.value = ''
                  }}
                />
                <Boton
                  type="button"
                  tono="secundario"
                  className="mt-3"
                  onClick={() => entrada.current?.click()}
                >
                  Elegir archivo
                </Boton>
                <p className="text-12 text-tinta-suave mt-2">
                  El PDF no sale de tu navegador. Revisa los datos antes de guardar.
                </p>
              </>
            )}
          </div>

          {errorPdf && (
            <div className="mt-3">
              <ErrorLinea error={new Error(errorPdf)} />
              <p className="text-12 text-tinta-suave mt-1">
                Captura los datos a mano, es igual de rápido.
              </p>
            </div>
          )}

          {estadoPdf === 'listo' && (
            <div className="mt-3 space-y-1">
              <p className="text-12 flex items-center gap-1.5" style={{ color: 'var(--accion)' }}>
                <Sparkles size={13} />
                Prellenado con tu PDF. Revísalo antes de guardar.
              </p>
              {confianza === 'baja' && (
                <p className="text-12" style={{ color: 'var(--naranja)' }}>
                  El documento se leyó con dificultad: revisa campo por campo.
                </p>
              )}
              {avisos.map(a => (
                <p key={a} className="text-12 text-tinta-suave">{a}</p>
              ))}
            </div>
          )}
        </section>
      )}

      <form onSubmit={guardar} className="space-y-3" noValidate>
        <CampoSelect
          etiqueta="¿Cómo pagas esta tarjeta?"
          value={modo}
          onChange={e => cambiarModo(e.target.value as ModoPago)}
          ayuda="De esto depende cuánto sale de tu cuenta cada mes, y con eso se calcula tu score y tu flujo de 30 días."
        >
          <option value="minimo">Pago el mínimo o un poco más</option>
          <option value="total">Pago todo, para no generar intereses</option>
        </CampoSelect>

        <div className="grid grid-cols-2 gap-3">
          <Campo
            etiqueta="Límite de crédito"
            type="number" min={0} step="any" prefijo="$"
            value={forma.limite}
            onChange={e => editar({ limite: e.target.value })}
            deIA={deIA.has('limite')}
            error={campos.limite}
          />
          <Campo
            etiqueta="Crédito disponible"
            type="number" min={0} step="any" prefijo="$"
            value={forma.disponible}
            onChange={e => editar({ disponible: e.target.value })}
            deIA={deIA.has('disponible')}
            error={campos.saldo}
            ayuda={debes !== null ? `Entonces debes ${mxn(debes)}` : 'Como viene en tu estado de cuenta'}
          />
          <Campo
            etiqueta="Tasa anual"
            type="number" min={0} step="any" sufijo="%"
            placeholder="38"
            value={forma.tasa_pct}
            onChange={e => editar({ tasa_pct: e.target.value })}
            deIA={deIA.has('tasa_pct')}
            error={campos.tasa_anual}
          />
          <Campo
            etiqueta={ETIQUETA_PAGO[modo]}
            type="number" min={0} step="any" prefijo="$"
            value={forma.pago}
            onChange={e => editar({ pago: e.target.value })}
            deIA={deIA.has('pago')}
            error={campos.pago_minimo}
            ayuda={AYUDA_PAGO[modo]}
          />
          <Campo
            etiqueta="Día de corte"
            type="number" min={1} max={31}
            value={forma.dia_corte}
            onChange={e => editar({ dia_corte: e.target.value })}
            deIA={deIA.has('dia_corte')}
            error={campos.dia_corte}
          />
          <Campo
            etiqueta="Día límite de pago"
            type="number" min={1} max={31}
            value={forma.dia_limite_pago}
            onChange={e => editar({ dia_limite_pago: e.target.value })}
            deIA={deIA.has('dia_limite_pago')}
            error={campos.dia_limite_pago}
          />
        </div>

        <Campo
          etiqueta="Compra mínima para meses sin intereses"
          type="number" min={0} step="any" prefijo="$"
          value={forma.monto_minimo_msi}
          onChange={e => editar({ monto_minimo_msi: e.target.value })}
          ayuda="Este dato no viene en el estado de cuenta, captúralo tú"
          error={campos.monto_minimo_msi}
        />

        <ListaPlanes filas={planes} onCambio={setPlanes} />

        {conflicto && (
          <div className="panel p-3" style={{ borderColor: 'var(--ambar)' }} role="alert">
            <p className="text-14">
              Algo movió esta tarjeta mientras tenías el formulario abierto.
            </p>
            <p className="text-12 text-tinta-suave mt-1 cifra">
              Ahora dice que debes {mxn(conflicto.saldo)} y que puedes usar{' '}
              {mxn(conflicto.disponible)}.
            </p>
            <div className="flex gap-2 mt-2">
              <Boton
                type="button"
                tono="secundario"
                onClick={() => {
                  setForma(desdeTarjeta(conflicto))
                  setPlanes((conflicto.msi ?? []).map(planExistente))
                  setConflicto(null)
                  setError(null)
                }}
              >
                Usar los datos nuevos
              </Boton>
              <Boton type="submit" tono="primario" cargando={enviando}>
                Guardar los míos de todos modos
              </Boton>
            </div>
          </div>
        )}

        {aviso && <ErrorLinea error={new Error(aviso)} />}
        {error != null && !conflicto && <ErrorLinea error={error} />}

        <div className="flex justify-end gap-2 pt-1">
          <Boton type="button" tono="fantasma" onClick={onCerrar}>Cancelar</Boton>
          <Boton type="submit" tono="primario" cargando={enviando}>Guardar</Boton>
        </div>
      </form>
    </Modal>
  )
}

function ListaPlanes({
  filas, onCambio,
}: { filas: FilaPlan[]; onCambio: (f: FilaPlan[]) => void }) {
  const editar = (i: number, cambio: Partial<FilaPlan>) =>
    onCambio(filas.map((f, j) => (j === i ? { ...f, ...cambio } : f)))

  return (
    <div className="pt-2">
      <p className="text-14 font-medium">Compras a meses sin intereses</p>
      <p className="text-12 text-tinta-suave mb-2">Opcional, solo las que sigues pagando.</p>

      <div className="space-y-4">
        {filas.map((m, i) => (
          <div key={m.id ?? `nueva-${i}`} className="relative pr-8">
            <button
              type="button"
              aria-label="Quitar compra a meses"
              onClick={() => onCambio(filas.filter((_, j) => j !== i))}
              className="absolute top-6 right-0 text-tinta-suave hover:text-tinta p-1"
            >
              <Trash2 size={16} />
            </button>
            <div className="grid gap-2 sm:grid-cols-[1fr_100px] items-start">
              <Campo
                etiqueta="¿Qué compraste?"
                placeholder="Celular"
                value={m.descripcion}
                onChange={e => editar(i, { descripcion: e.target.value })}
              />
              <Campo
                etiqueta="Al mes"
                type="number" min={0} step="any" prefijo="$"
                value={m.monto_mensual}
                onChange={e => editar(i, { monto_mensual: e.target.value })}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-3 items-start mt-2">
              <Campo
                etiqueta="A cuántos meses"
                type="number" min={1} max={60}
                value={m.meses_totales}
                onChange={e => editar(i, { meses_totales: e.target.value })}
                deIA={false}
                ayuda={m.id === null && m.meses_totales === '' ? 'El PDF no lo trae' : undefined}
              />
              <Campo
                etiqueta="Meses que faltan"
                type="number" min={0} max={60}
                value={m.meses_restantes}
                onChange={e => editar(i, { meses_restantes: e.target.value })}
              />
              {/* El backend deriva los meses que faltan de esta fecha, no de un
                  contador: un contador que nadie decrementa cada mes es una
                  deuda que parece pagarse sola. */}
              <Campo
                etiqueta="Empezó en"
                type="date"
                max={hoyISO()}
                value={m.fecha_inicio || inicioDePlan(m.meses_totales, m.meses_restantes)}
                onChange={e => editar(i, { fecha_inicio: e.target.value })}
                ayuda={m.id === null ? 'Calculada. Corrígela si sabes la real.' : undefined}
                disabled={m.id !== null}
              />
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onCambio([...filas, {
          id: null, descripcion: '', monto_mensual: '',
          meses_totales: '', meses_restantes: '', fecha_inicio: '',
        }])}
        className="flex items-center gap-2 text-14 text-accion mt-3 hover:underline"
      >
        <Plus size={16} />
        Agregar una compra a meses
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- cortes
/**
 * Los cortes de la tarjeta.
 *
 * En crédito mexicano lo que determina si pagas intereses no es el saldo de
 * hoy: es el saldo al corte. Un gasto del día 16 cae en el siguiente periodo.
 *
 * Las tres fechas se capturan explícitas en vez de derivarse de `dia_corte`
 * porque los bancos recorren el corte por fines de semana y festivos, y el
 * usuario tiene la fecha real delante en su estado de cuenta.
 *
 * Y el cierre es un botón, no un proceso de fondo: la app es una foto del
 * presente, y un cron que hay que dejar corriendo es justo lo que no queremos
 * que falle en mitad de una demo.
 */
function ModalCortes({
  tarjeta, onCerrar,
}: { tarjeta: TarjetaResumen; onCerrar: () => void }) {
  const cargar = useCallback(() => api.periodos(tarjeta.id), [tarjeta.id])
  const { datos, error, cargando, recargar } = usarDatos(cargar)

  const [abriendo, setAbriendo] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const [errorAccion, setErrorAccion] = useState<unknown>(null)

  const periodos = datos?.data ?? []
  const abierto = periodos.find(p => !p.cerrado) ?? null

  async function cerrar(p: PeriodoResumen) {
    setTrabajando(true)
    setErrorAccion(null)
    try {
      await api.cerrarPeriodo(tarjeta.id, p.id)
      recargar()
    } catch (e) {
      setErrorAccion(e)
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <Modal titulo={`Cortes de ${tarjeta.nombre}`} onCerrar={onCerrar}>
      {cargando && !datos && <CargandoPanel lineas={3} />}
      {!cargando && !datos && <ErrorApi error={error} reintentar={recargar} />}

      {datos && periodos.length === 0 && !abriendo && (
        <p className="text-14 text-tinta-suave">
          Todavía no registras un corte. Con el de tu estado de cuenta podemos
          decirte cuánto pagar para no generar intereses.
        </p>
      )}

      {periodos.length > 0 && (
        <ul className="space-y-3">
          {periodos.map(p => (
            <li key={p.id} className="border border-linea rounded-lg p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-14 font-medium">
                  Corte del {fechaLarga(p.fecha_corte)}
                </p>
                <span className="text-12 text-tinta-suave">
                  {p.cerrado ? 'Cerrado' : 'Abierto'}
                </span>
              </div>

              {/* Tres cifras que la gente confunde, y aquí van separadas. */}
              <dl className="grid grid-cols-3 gap-2 mt-2">
                <Dato etiqueta="Debías al corte" valor={mxn(p.saldo_al_corte)} />
                <Dato etiqueta="Mínimo" valor={mxn(p.pago_minimo)} />
                <Dato etiqueta="Sin intereses" valor={mxn(p.pago_no_intereses)} />
              </dl>

              <p className="text-12 text-tinta-suave mt-2">
                Pagando {mxn(p.pago_no_intereses)} antes del{' '}
                {fechaLarga(p.fecha_limite_pago)}, la tasa no corre.
                {p.pagado > 0 && ` Llevas ${mxn(p.pagado)}.`}
              </p>

              {!p.cerrado && (
                <Boton
                  tono="secundario"
                  className="mt-3"
                  cargando={trabajando}
                  onClick={() => cerrar(p)}
                >
                  Cerrar este corte
                </Boton>
              )}
            </li>
          ))}
        </ul>
      )}

      {errorAccion != null && <div className="mt-3"><ErrorLinea error={errorAccion} /></div>}

      {abriendo ? (
        <FormaPeriodo
          tarjeta={tarjeta}
          onCancelar={() => setAbriendo(false)}
          onAbierto={() => { setAbriendo(false); recargar() }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAbriendo(true)}
          disabled={abierto !== null}
          className="flex items-center gap-2 text-14 text-accion mt-2 py-2
                     hover:underline disabled:opacity-40 disabled:no-underline"
        >
          <Plus size={16} />
          {abierto ? 'Cierra el corte abierto para registrar otro' : 'Registrar un corte'}
        </button>
      )}
    </Modal>
  )
}

function FormaPeriodo({
  tarjeta, onCancelar, onAbierto,
}: { tarjeta: TarjetaResumen; onCancelar: () => void; onAbierto: () => void }) {
  const [inicio, setInicio] = useState('')
  const [corte, setCorte] = useState('')
  const [limite, setLimite] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const campos = camposConError(error)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setAviso(null)
    if (!inicio || !corte || !limite) { setAviso('Faltan las tres fechas'); return }
    if (corte <= inicio) { setAviso('El corte va después del inicio del periodo'); return }
    if (limite <= corte) { setAviso('La fecha límite de pago va después del corte'); return }

    const cuerpo: PeriodoCreate = {
      fecha_inicio: inicio, fecha_corte: corte, fecha_limite_pago: limite,
    }
    setEnviando(true)
    try {
      await api.abrirPeriodo(tarjeta.id, cuerpo)
      onAbierto()
    } catch (err) {
      setError(err)
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="border-t border-linea mt-4 pt-4 space-y-3" noValidate>
      <p className="text-14 font-medium">Registrar un corte</p>
      <p className="text-12 text-tinta-suave">
        Las tres fechas vienen impresas en tu estado de cuenta. Se capturan tal
        cual porque los bancos las recorren por fines de semana.
      </p>

      <Campo
        etiqueta="El periodo empezó el"
        type="date"
        value={inicio}
        onChange={e => setInicio(e.target.value)}
        error={campos.fecha_inicio}
      />
      <Campo
        etiqueta="Cortó el"
        type="date"
        value={corte}
        onChange={e => setCorte(e.target.value)}
        error={campos.fecha_corte}
      />
      <Campo
        etiqueta="Se paga antes del"
        type="date"
        value={limite}
        onChange={e => setLimite(e.target.value)}
        error={campos.fecha_limite_pago}
      />

      {aviso && <ErrorLinea error={new Error(aviso)} />}
      {error != null && <ErrorLinea error={error} />}

      <div className="flex justify-end gap-2">
        <Boton type="button" tono="fantasma" onClick={onCancelar}>Cancelar</Boton>
        <Boton type="submit" tono="primario" cargando={enviando}>Registrar</Boton>
      </div>
    </form>
  )
}
