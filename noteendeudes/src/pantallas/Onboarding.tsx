import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import * as api from '../lib/api'
import { ApiException } from '../lib/api'
import { useSesion } from '../auth/AuthContext'
import { mxn, hoyISO } from '../lib/formato'
import { useCategorias } from '../lib/categorias'
import { AYUDA_PAGO, ETIQUETA_PAGO, guardarModo } from '../lib/pagoTarjeta'
import type { ModoPago } from '../lib/pagoTarjeta'
import {
  AJUSTES_MES_CORTO, FACTOR_MENSUAL, FRECUENCIAS, FRECUENCIAS_MESES,
  familiaFrecuencia,
} from '../lib/ui-tipos'
import type {
  AjusteMesCorto, Frecuencia, IngresoCreate, MSICreate, OnboardingRequest,
  OnboardingResponse, RecurrenteCreate, TarjetaOnboarding, TipoTarjeta,
} from '../lib/tipos'
import Boton from '../componentes/Boton'
import Campo, { CampoCheck, CampoSelect } from '../componentes/Campo'
import { ErrorLinea } from '../componentes/ErrorApi'

// Los formularios guardan texto: un campo vacío no es 0.
interface FilaIngreso {
  concepto: string; monto: string; frecuencia: Frecuencia
  dia_pago: string; dia_pago_2: string
  // Semanal y catorcenal se definen por una fecha de cobro real, no por dias
  // del mes: son 52 y 26 pagos al ano, y hay meses con dos y meses con tres.
  fecha_ancla: string
  ajuste_mes_corto: AjusteMesCorto
}
interface FilaMSI {
  descripcion: string; monto_mensual: string
  meses_totales: string; meses_restantes: string
  /** Vacia = derivada de los dos contadores. El backend deriva al reves. */
  fecha_inicio: string
}
interface FilaTarjeta {
  banco: string; nombre: string; tipo: TipoTarjeta
  // Se captura el DISPONIBLE, no el saldo: es el numero impreso en el estado
  // de cuenta. El saldo sale de la resta contra el limite.
  limite: string; disponible: string; tasa_pct: string
  modo_pago: ModoPago; pago: string
  dia_corte: string; dia_limite_pago: string; monto_minimo_msi: string
  msi: FilaMSI[]
}
interface FilaGasto {
  concepto: string; monto: string; dia_del_mes: string; categoria: string
  /** OBLIGATORIA: define la FASE del ciclo, no es un dato administrativo. */
  fecha_inicio: string
  frecuencia_meses: string
  es_variable: boolean
}

const num = (s: string) => Number(s.replace(/,/g, ''))
const vacio = (s: string) => s.trim() === ''

/**
 * Cuando empezo un plan a meses, contando hacia atras desde hoy.
 *
 * En el backend `meses_restantes` sale de `fecha_inicio`, no de un contador
 * guardado. El estado de cuenta imprime los contadores, asi que se hace el
 * camino inverso y el resultado queda editable: si la fecha real no cuadra,
 * el usuario la corrige.
 */
function inicioDeMSI(mesesTotales: string, mesesRestantes: string): string {
  const t = num(mesesTotales)
  const r = num(mesesRestantes)
  if (!(t > 0) || !(r >= 0) || r > t) return hoyISO()
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - (t - r))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/** Lo que debes es el resto del limite; se muestra en vivo bajo el disponible. */
const debeEn = (t: FilaTarjeta): number | null =>
  vacio(t.limite) || vacio(t.disponible)
    ? null
    : Math.round((num(t.limite) - num(t.disponible)) * 100) / 100

const PASOS = ['Tu dinero', 'Lo que entra', 'Tus tarjetas', 'Lo que sale']

export default function Onboarding() {
  const navegar = useNavigate()
  const { usuario, marcarOnboardingCompleto } = useSesion()

  const [paso, setPaso] = useState(0)
  const [liquidez, setLiquidez] = useState('')
  const [ingresos, setIngresos] = useState<FilaIngreso[]>([])
  const [tarjetas, setTarjetas] = useState<FilaTarjeta[]>([])
  const [gastos, setGastos] = useState<FilaGasto[]>([])

  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [listo, setListo] = useState<OnboardingResponse | null>(null)

  if (listo) return <Exito respuesta={listo} onSeguir={() => navegar('/dashboard')} />

  function validarPaso(): string | null {
    if (paso === 0) {
      if (vacio(liquidez) || !(num(liquidez) >= 0)) {
        return 'Escribe cuánto dinero tienes disponible hoy'
      }
    }
    if (paso === 1) {
      for (const i of ingresos) {
        if (vacio(i.concepto)) return 'Cada ingreso necesita un nombre'
        if (!(num(i.monto) > 0)) return `¿De cuánto es cada pago de ${i.concepto}?`
        const familia = familiaFrecuencia(i.frecuencia)
        if (familia === 'ancla') {
          if (vacio(i.fecha_ancla)) {
            return `¿Cuándo te pagaron ${i.concepto} la última vez? Un ingreso ${i.frecuencia} se cuenta en días, no en días del mes`
          }
        } else {
          if (vacio(i.dia_pago)) return `¿Qué día te pagan ${i.concepto}?`
          if (familia === 'dos_dias') {
            if (vacio(i.dia_pago_2)) {
              return `Un ingreso quincenal cae dos veces al mes: falta el segundo día en ${i.concepto}`
            }
            if (num(i.dia_pago) === num(i.dia_pago_2)) {
              return `Los dos días de pago de ${i.concepto} no pueden ser el mismo`
            }
          }
        }
      }
    }
    if (paso === 2) {
      for (const t of tarjetas) {
        if (vacio(t.banco)) return 'Cada tarjeta necesita el banco'
        if (t.tipo === 'debito') continue
        if (!(num(t.limite) > 0)) return `¿Cuál es el límite de ${t.nombre || t.banco}?`
        if (vacio(t.disponible) || num(t.disponible) < 0) {
          return `¿Cuánto crédito disponible te queda en ${t.nombre || t.banco}?`
        }
        if (num(t.disponible) > num(t.limite)) {
          return `El disponible de ${t.nombre || t.banco} no puede pasar de su límite`
        }
        if (!(num(t.tasa_pct) > 0)) return `¿Qué tasa anual te cobra ${t.nombre || t.banco}?`
        for (const m of t.msi) {
          if (!(num(m.monto_mensual) > 0)) continue
          if (!(num(m.meses_totales) > 0)) {
            return `¿A cuántos meses compraste ${m.descripcion || 'esa compra'} en ${t.nombre || t.banco}?`
          }
          if (num(m.meses_restantes) > num(m.meses_totales)) {
            return `A ${m.descripcion || 'esa compra'} no le pueden faltar más meses de los que compraste`
          }
        }
        if (vacio(t.dia_corte) || vacio(t.dia_limite_pago)) {
          return `Faltan las fechas de corte y pago de ${t.nombre || t.banco}`
        }
        if (num(t.dia_corte) === num(t.dia_limite_pago)) {
          return `En ${t.nombre || t.banco} el día de corte y el de pago no pueden ser el mismo`
        }
      }
    }
    if (paso === 3) {
      for (const g of gastos) {
        if (vacio(g.concepto)) return 'Cada gasto fijo necesita un nombre'
        if (!(num(g.monto) > 0)) return `¿De cuánto es ${g.concepto}?`
        if (vacio(g.dia_del_mes)) return `¿Qué día del mes cae ${g.concepto}?`
        if (vacio(g.fecha_inicio)) {
          return `¿Desde cuándo pagas ${g.concepto}? Sin esa fecha no sabemos en qué meses cae`
        }
      }
    }
    return null
  }

  /**
   * Lo que va DESPUES del alta, en una sola lectura de /tarjetas.
   *
   * POST /onboarding devuelve conteos, no ids, asi que las tarjetas recien
   * creadas se recuperan por nombre. Con su id se hacen dos cosas: anotar el
   * modo de pago (que el contrato no tiene donde guardar) y dar de alta los
   * planes a meses, que ya no viajan dentro de `terminos` y son su propio
   * recurso.
   *
   * El onboarding es todo-o-nada; esto es el despues. Si falla, se pierde una
   * etiqueta o un plan, no el alta: se avisa sin bloquear.
   */
  async function despuesDelAlta(): Promise<string | null> {
    const deCredito = tarjetas.filter(t => t.tipo === 'credito')
    if (deCredito.length === 0) return null

    let creadas
    try {
      creadas = (await api.tarjetas()).data
    } catch {
      return null
    }

    let fallaronPlanes = 0
    for (const t of deCredito) {
      const nombre = t.nombre.trim() || t.banco.trim()
      const par = creadas.find(c => c.tipo === 'credito' && c.nombre === nombre)
      if (!par) continue
      guardarModo(par.id, t.modo_pago)

      for (const m of t.msi) {
        if (!(num(m.monto_mensual) > 0) || !(num(m.meses_totales) > 0)) continue
        const plan: MSICreate = {
          tarjeta_id: par.id,
          monto_mensual: num(m.monto_mensual),
          meses_totales: num(m.meses_totales),
          meses_restantes: num(m.meses_restantes),
          fecha_inicio: m.fecha_inicio || inicioDeMSI(m.meses_totales, m.meses_restantes),
          ...(m.descripcion.trim() ? { descripcion: m.descripcion.trim() } : {}),
        }
        try {
          await api.crearMSI(plan)
        } catch {
          fallaronPlanes += 1
        }
      }
    }

    return fallaronPlanes > 0
      ? `Se guardó todo menos ${fallaronPlanes} compra(s) a meses. Puedes agregarlas desde Tarjetas.`
      : null
  }

  function avanzar() {
    const problema = validarPaso()
    if (problema) { setAviso(problema); return }
    setAviso(null)
    if (paso < 3) setPaso(paso + 1)
    else enviar()
  }

  async function enviar() {
    setEnviando(true)
    setError(null)
    // Todo o nada: si algo viene mal no se guarda ni la liquidez, así que
    // reintentar el formulario completo no duplica nada.
    const cuerpo: OnboardingRequest = {
      liquidez: num(liquidez),
      // Las dos familias mandan cosas distintas, y mandar de mas es 422:
      // en semanal y catorcenal `dia_pago_2` esta PROHIBIDO, y en mensual
      // tambien.
      ingresos: ingresos.map<IngresoCreate>(i => {
        const familia = familiaFrecuencia(i.frecuencia)
        return {
          concepto: i.concepto.trim(),
          monto: num(i.monto),
          frecuencia: i.frecuencia,
          ajuste_mes_corto: i.ajuste_mes_corto,
          ...(familia === 'ancla'
            ? { fecha_ancla: i.fecha_ancla }
            : {
                dia_pago: num(i.dia_pago),
                ...(familia === 'dos_dias' ? { dia_pago_2: num(i.dia_pago_2) } : {}),
              }),
        }
      }),
      tarjetas: tarjetas.map<TarjetaOnboarding>(t => ({
        banco: t.banco.trim(),
        nombre: (t.nombre.trim() || t.banco.trim()),
        tipo: t.tipo,
        // Débito: prohibido mandar términos. Crédito: obligatorios.
        ...(t.tipo === 'credito'
          ? {
              terminos: {
                limite: num(t.limite),
                // El backend calcula disponible = limite - saldo. Derivando el
                // saldo al reves, el disponible de la app cuadra con el impreso.
                saldo: Math.round((num(t.limite) - num(t.disponible)) * 100) / 100,
                // Se captura como 38 y viaja como 0.38.
                tasa_anual: num(t.tasa_pct) / 100,
                pago_minimo: vacio(t.pago) ? 0 : num(t.pago),
                dia_corte: num(t.dia_corte),
                dia_limite_pago: num(t.dia_limite_pago),
                monto_minimo_msi: vacio(t.monto_minimo_msi) ? 0 : num(t.monto_minimo_msi),
                // Los planes a meses ya NO van aqui: son su propio recurso y
                // se dan de alta en despuesDelAlta(), con el id de la tarjeta.
              },
            }
          : {}),
      })),
      gastos_fijos: gastos.map<RecurrenteCreate>(g => ({
        concepto: g.concepto.trim(),
        monto: num(g.monto),
        dia_del_mes: num(g.dia_del_mes),
        categoria: g.categoria,
        // Define la FASE del ciclo: la luz bimestral de quien empezo en enero
        // cae en meses nones y la de quien empezo en febrero, en pares.
        fecha_inicio: g.fecha_inicio,
        frecuencia_meses: num(g.frecuencia_meses),
        es_variable: g.es_variable,
      })),
    }

    try {
      const respuesta = await api.onboarding(cuerpo)
      const problema = await despuesDelAlta()
      if (problema) setAviso(problema)
      setListo(respuesta)
      marcarOnboardingCompleto()
    } catch (e) {
      // 409 significa que ya lo hiciste: al dashboard.
      if (e instanceof ApiException && e.status === 409) {
        marcarOnboardingCompleto()
        navegar('/dashboard', { replace: true })
        return
      }
      setError(e)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="mx-auto max-w-[720px] px-4 py-6">
      <header className="mb-5">
        <h1 className="font-titulo text-20">
          {usuario ? `Hola ${usuario.nombre.split(' ')[0]}` : 'Hola'}, cuéntanos de tu dinero
        </h1>
        <p className="text-14 text-tinta-suave mt-1">
          Con esto podemos decirte si te conviene una compra. Nunca te pedimos
          números de tarjeta.
        </p>

        <ol className="flex gap-1.5 mt-4" aria-label={`Paso ${paso + 1} de 4`}>
          {PASOS.map((p, i) => (
            <li key={p} className="flex-1">
              <div
                className="h-1 rounded-full"
                style={{ background: i <= paso ? 'var(--accion)' : 'var(--linea)' }}
              />
              <span
                className={`text-12 mt-1 block ${i === paso ? 'text-tinta' : 'text-tinta-suave'}`}
              >
                {p}
              </span>
            </li>
          ))}
        </ol>
      </header>

      <div className="panel p-5">
        {paso === 0 && <PasoLiquidez valor={liquidez} onCambio={setLiquidez} />}
        {paso === 1 && <PasoIngresos filas={ingresos} onCambio={setIngresos} />}
        {paso === 2 && <PasoTarjetas filas={tarjetas} onCambio={setTarjetas} />}
        {paso === 3 && <PasoGastos filas={gastos} onCambio={setGastos} />}
      </div>

      {aviso && <div className="mt-3"><ErrorLinea error={new Error(aviso)} /></div>}
      {error != null && <div className="mt-3"><ErrorLinea error={error} /></div>}

      <div className="flex justify-between items-center gap-3 mt-5">
        <Boton
          tono="fantasma"
          onClick={() => { setAviso(null); setPaso(p => Math.max(0, p - 1)) }}
          disabled={paso === 0 || enviando}
        >
          Atrás
        </Boton>
        <Boton tono="primario" grande onClick={avanzar} cargando={enviando}>
          {paso === 3 ? 'Terminar' : 'Siguiente'}
        </Boton>
      </div>
    </div>
  )
}

// ------------------------------------------------------------- paso 1
function PasoLiquidez({
  valor, onCambio,
}: { valor: string; onCambio: (v: string) => void }) {
  return (
    <>
      <h2 className="font-titulo text-16 mb-1">¿Cuánto dinero tienes disponible hoy?</h2>
      <p className="text-14 text-tinta-suave mb-4">
        Lo que traes en el banco y en efectivo, junto. Es el único dato obligatorio.
      </p>
      <Campo
        etiqueta="Disponible hoy"
        type="number"
        min={0}
        step="any"
        prefijo="$"
        autoFocus
        value={valor}
        onChange={e => onCambio(e.target.value)}
        className="text-32 font-titulo pl-8"
      />
    </>
  )
}

// ------------------------------------------------------------- paso 2
function PasoIngresos({
  filas, onCambio,
}: { filas: FilaIngreso[]; onCambio: (f: FilaIngreso[]) => void }) {
  const editar = (i: number, cambio: Partial<FilaIngreso>) =>
    onCambio(filas.map((f, j) => (j === i ? { ...f, ...cambio } : f)))

  return (
    <>
      <h2 className="font-titulo text-16 mb-1">¿De dónde te entra dinero?</h2>
      <p className="text-14 text-tinta-suave mb-4">
        Puedes dejarlo vacío y agregarlo después.
      </p>

      <div className="space-y-4">
        {filas.map((f, i) => {
          const familia = familiaFrecuencia(f.frecuencia)
          const mensual = num(f.monto) > 0 ? num(f.monto) * FACTOR_MENSUAL[f.frecuencia] : 0
          // El ajuste solo importa si el dia puede no existir en el mes.
          const diaDudoso = num(f.dia_pago) > 28 || num(f.dia_pago_2) > 28
          return (
            <div key={i} className="border border-linea rounded-lg p-4 relative">
              <BotonQuitar
                etiqueta="Quitar ingreso"
                onClick={() => onCambio(filas.filter((_, j) => j !== i))}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo
                  etiqueta="¿Qué es?"
                  placeholder="Nómina, freelance…"
                  value={f.concepto}
                  onChange={e => editar(i, { concepto: e.target.value })}
                />
                <Campo
                  etiqueta="¿Cuánto entra en cada pago?"
                  type="number"
                  min={0}
                  step="any"
                  prefijo="$"
                  value={f.monto}
                  onChange={e => editar(i, { monto: e.target.value })}
                  ayuda={mensual > 0 ? `Al mes son ${mxn(Math.round(mensual))}` : 'No el total del mes'}
                />
                <CampoSelect
                  etiqueta="¿Cada cuánto?"
                  value={f.frecuencia}
                  onChange={e => editar(i, { frecuencia: e.target.value as Frecuencia })}
                >
                  {FRECUENCIAS.map(fr => (
                    <option key={fr.valor} value={fr.valor}>{fr.etiqueta}</option>
                  ))}
                </CampoSelect>
                {/* Dos familias: una se ancla a una fecha real y se cuenta
                    en dias; la otra vive en dias del mes. */}
                {familia === 'ancla' ? (
                  <Campo
                    etiqueta="¿Cuándo fue un pago real?"
                    type="date"
                    max={hoyISO()}
                    value={f.fecha_ancla}
                    onChange={e => editar(i, { fecha_ancla: e.target.value })}
                    ayuda={f.frecuencia === 'catorcenal'
                      ? 'Son 26 pagos al año: hay meses con dos y meses con tres, así que se cuenta desde una fecha.'
                      : 'Desde ahí contamos cada semana.'}
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <Campo
                      etiqueta={familia === 'dos_dias' ? 'Primer día' : 'Día de pago'}
                      type="number"
                      min={1}
                      max={31}
                      value={f.dia_pago}
                      onChange={e => editar(i, { dia_pago: e.target.value })}
                    />
                    {familia === 'dos_dias' && (
                      <Campo
                        etiqueta="Segundo día"
                        type="number"
                        min={1}
                        max={31}
                        value={f.dia_pago_2}
                        onChange={e => editar(i, { dia_pago_2: e.target.value })}
                      />
                    )}
                  </div>
                )}
              </div>

              {familia !== 'ancla' && diaDudoso && (
                <div className="mt-3">
                  <CampoSelect
                    etiqueta="Si el mes no tiene ese día, ¿cuándo te pagan?"
                    value={f.ajuste_mes_corto}
                    onChange={e => editar(i, {
                      ajuste_mes_corto: e.target.value as AjusteMesCorto,
                    })}
                    ayuda="Febrero no tiene 30, y abril no tiene 31."
                  >
                    {AJUSTES_MES_CORTO.map(a => (
                      <option key={a.valor} value={a.valor}>{a.etiqueta}</option>
                    ))}
                  </CampoSelect>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <BotonAgregar
        texto="Agregar un ingreso"
        onClick={() => onCambio([...filas, {
          concepto: '', monto: '', frecuencia: 'quincenal', dia_pago: '',
          dia_pago_2: '', fecha_ancla: '', ajuste_mes_corto: 'ultimo_dia',
        }])}
      />
    </>
  )
}

// ------------------------------------------------------------- paso 3
function PasoTarjetas({
  filas, onCambio,
}: { filas: FilaTarjeta[]; onCambio: (f: FilaTarjeta[]) => void }) {
  const editar = (i: number, cambio: Partial<FilaTarjeta>) =>
    onCambio(filas.map((f, j) => (j === i ? { ...f, ...cambio } : f)))

  return (
    <>
      <h2 className="font-titulo text-16 mb-1">¿Qué tarjetas usas?</h2>
      <p className="text-14 text-tinta-suave mb-4">
        Solo los datos del estado de cuenta. Nunca el número de la tarjeta.
      </p>

      <div className="space-y-4">
        {filas.map((t, i) => (
          <div key={i} className="border border-linea rounded-lg p-4 relative">
            <BotonQuitar
              etiqueta="Quitar tarjeta"
              onClick={() => onCambio(filas.filter((_, j) => j !== i))}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo
                etiqueta="Banco"
                placeholder="BBVA, NU, Santander…"
                value={t.banco}
                onChange={e => editar(i, { banco: e.target.value })}
              />
              <CampoSelect
                etiqueta="Tipo"
                value={t.tipo}
                onChange={e => editar(i, { tipo: e.target.value as TipoTarjeta })}
              >
                <option value="credito">Crédito</option>
                <option value="debito">Débito</option>
              </CampoSelect>
            </div>

            {t.tipo === 'credito' && (
              <>
                <div className="mt-3">
                  <CampoSelect
                    etiqueta="¿Cómo pagas esta tarjeta?"
                    value={t.modo_pago}
                    onChange={e => editar(i, { modo_pago: e.target.value as ModoPago })}
                    ayuda="De esto depende cuánto sale de tu cuenta cada mes."
                  >
                    <option value="minimo">Pago el mínimo o un poco más</option>
                    <option value="total">Pago todo, para no generar intereses</option>
                  </CampoSelect>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 mt-3">
                  <Campo
                    etiqueta="Límite de crédito"
                    type="number" min={0} step="any" prefijo="$"
                    value={t.limite}
                    onChange={e => editar(i, { limite: e.target.value })}
                  />
                  <Campo
                    etiqueta="Crédito disponible"
                    type="number" min={0} step="any" prefijo="$"
                    value={t.disponible}
                    onChange={e => editar(i, { disponible: e.target.value })}
                    ayuda={debeEn(t) !== null
                      ? `Entonces debes ${mxn(debeEn(t)!)}`
                      : 'Como viene en tu estado de cuenta'}
                  />
                  <Campo
                    etiqueta="Tasa anual"
                    type="number" min={0} step="any" sufijo="%"
                    placeholder="38"
                    value={t.tasa_pct}
                    onChange={e => editar(i, { tasa_pct: e.target.value })}
                    ayuda="Como viene en tu estado de cuenta"
                  />
                  <Campo
                    etiqueta={ETIQUETA_PAGO[t.modo_pago]}
                    type="number" min={0} step="any" prefijo="$"
                    value={t.pago}
                    onChange={e => editar(i, { pago: e.target.value })}
                    ayuda={AYUDA_PAGO[t.modo_pago]}
                  />
                  <Campo
                    etiqueta="Día de corte"
                    type="number" min={1} max={31}
                    value={t.dia_corte}
                    onChange={e => editar(i, { dia_corte: e.target.value })}
                  />
                  <Campo
                    etiqueta="Día límite de pago"
                    type="number" min={1} max={31}
                    value={t.dia_limite_pago}
                    onChange={e => editar(i, { dia_limite_pago: e.target.value })}
                  />
                  <Campo
                    etiqueta="Compra mínima para meses"
                    type="number" min={0} step="any" prefijo="$"
                    value={t.monto_minimo_msi}
                    onChange={e => editar(i, { monto_minimo_msi: e.target.value })}
                    ayuda="Déjalo en blanco si no sabes"
                  />
                </div>

                <MSIVigentes
                  filas={t.msi}
                  onCambio={msi => editar(i, { msi })}
                />
              </>
            )}
          </div>
        ))}
      </div>

      <BotonAgregar
        texto="Agregar una tarjeta"
        onClick={() => onCambio([...filas, {
          banco: '', nombre: '', tipo: 'credito', limite: '', disponible: '',
          tasa_pct: '', modo_pago: 'minimo', pago: '', dia_corte: '', dia_limite_pago: '',
          monto_minimo_msi: '', msi: [],
        }])}
      />
    </>
  )
}

function MSIVigentes({
  filas, onCambio,
}: { filas: FilaMSI[]; onCambio: (f: FilaMSI[]) => void }) {
  const editar = (i: number, cambio: Partial<FilaMSI>) =>
    onCambio(filas.map((f, j) => (j === i ? { ...f, ...cambio } : f)))

  return (
    <div className="mt-4 pt-3 border-t border-linea">
      <p className="text-14 font-medium">¿Traes compras a meses sin intereses?</p>
      <p className="text-12 text-tinta-suave mb-3">Opcional, solo las que sigues pagando.</p>

      <div className="space-y-4">
        {filas.map((m, i) => (
          <div key={i} className="relative pr-8">
            <button
              type="button"
              aria-label="Quitar compra a meses"
              onClick={() => onCambio(filas.filter((_, j) => j !== i))}
              className="absolute top-6 right-0 text-tinta-suave hover:text-tinta p-1"
            >
              <Trash2 size={16} />
            </button>
            <div className="grid gap-2 sm:grid-cols-[1fr_120px] items-start">
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
              />
              <Campo
                etiqueta="Meses que faltan"
                type="number" min={0} max={60}
                value={m.meses_restantes}
                onChange={e => editar(i, { meses_restantes: e.target.value })}
              />
              {/* Los meses que faltan los deriva el backend de esta fecha, no
                  de un contador: por eso hace falta y se propone calculada. */}
              <Campo
                etiqueta="Empezó en"
                type="date"
                max={hoyISO()}
                value={m.fecha_inicio || inicioDeMSI(m.meses_totales, m.meses_restantes)}
                onChange={e => editar(i, { fecha_inicio: e.target.value })}
                ayuda="Calculada. Corrígela si tu estado de cuenta dice otra."
              />
            </div>
          </div>
        ))}
      </div>

      <BotonAgregar
        texto="Agregar una compra a meses"
        onClick={() => onCambio([...filas, {
          descripcion: '', monto_mensual: '', meses_totales: '',
          meses_restantes: '', fecha_inicio: '',
        }])}
      />
    </div>
  )
}

// ------------------------------------------------------------- paso 4
function PasoGastos({
  filas, onCambio,
}: { filas: FilaGasto[]; onCambio: (f: FilaGasto[]) => void }) {
  const { categorias } = useCategorias()
  const editar = (i: number, cambio: Partial<FilaGasto>) =>
    onCambio(filas.map((f, j) => (j === i ? { ...f, ...cambio } : f)))

  return (
    <>
      <h2 className="font-titulo text-16 mb-1">¿Qué pagas sí o sí?</h2>
      <p className="text-14 text-tinta-suave mb-4">
        Renta, servicios, suscripciones, colegiaturas. No todo es mensual: el
        predial es anual y la luz suele ser bimestral.
      </p>

      <div className="space-y-4">
        {filas.map((g, i) => (
          <div key={i} className="border border-linea rounded-lg p-4 relative">
            <BotonQuitar
              etiqueta="Quitar gasto fijo"
              onClick={() => onCambio(filas.filter((_, j) => j !== i))}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo
                etiqueta="¿Qué es?"
                placeholder="Renta, luz, internet…"
                value={g.concepto}
                onChange={e => editar(i, { concepto: e.target.value })}
              />
              <Campo
                etiqueta="¿Cuánto?"
                type="number" min={0} step="any" prefijo="$"
                value={g.monto}
                onChange={e => editar(i, { monto: e.target.value })}
                ayuda={g.es_variable ? 'Un aproximado; luego se ajusta solo' : undefined}
              />
              <Campo
                etiqueta="¿Qué día del mes cae?"
                type="number" min={1} max={31}
                value={g.dia_del_mes}
                onChange={e => editar(i, { dia_del_mes: e.target.value })}
              />
              <CampoSelect
                etiqueta="Categoría"
                value={g.categoria}
                onChange={e => editar(i, { categoria: e.target.value })}
              >
                {categorias.map(c => (
                  <option key={c.clave} value={c.clave}>{c.nombre}</option>
                ))}
              </CampoSelect>
              <CampoSelect
                etiqueta="¿Cada cuánto llega?"
                value={g.frecuencia_meses}
                onChange={e => editar(i, { frecuencia_meses: e.target.value })}
              >
                {FRECUENCIAS_MESES.map(f => (
                  <option key={f.valor} value={String(f.valor)}>{f.etiqueta}</option>
                ))}
              </CampoSelect>
              {/* Define la FASE del ciclo, no es burocracia: sin ella todos
                  los bimestrales caerian el mismo mes. */}
              <Campo
                etiqueta="¿Desde cuándo lo pagas?"
                type="date"
                value={g.fecha_inicio}
                onChange={e => editar(i, { fecha_inicio: e.target.value })}
                ayuda={num(g.frecuencia_meses) > 1
                  ? 'Con esto sabemos en qué meses cae, no solo cada cuánto.'
                  : 'Desde cuándo lo vienes pagando.'}
              />
            </div>

            <div className="mt-3">
              <CampoCheck
                etiqueta="El monto cambia cada vez"
                ayuda="Luz, agua, gas. Antes de darlo por pagado te preguntamos de cuánto vino."
                checked={g.es_variable}
                onChange={e => editar(i, { es_variable: e.target.checked })}
              />
            </div>
          </div>
        ))}
      </div>

      <BotonAgregar
        texto="Agregar un gasto fijo"
        onClick={() => onCambio([...filas, {
          concepto: '', monto: '', dia_del_mes: '',
          categoria: categorias[0]?.clave ?? 'otros',
          fecha_inicio: hoyISO(), frecuencia_meses: '1', es_variable: false,
        }])}
      />
    </>
  )
}

// ------------------------------------------------------------- comunes
function BotonAgregar({ texto, onClick }: { texto: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 text-14 text-accion mt-4 hover:underline"
    >
      <Plus size={16} />
      {texto}
    </button>
  )
}

function BotonQuitar({ etiqueta, onClick }: { etiqueta: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      onClick={onClick}
      className="absolute top-3 right-3 text-tinta-suave hover:text-tinta p-1"
    >
      <Trash2 size={16} />
    </button>
  )
}

function Exito({
  respuesta, onSeguir,
}: { respuesta: OnboardingResponse; onSeguir: () => void }) {
  return (
    <div className="mx-auto max-w-[520px] px-4 py-10">
      <h1 className="font-titulo text-32">Listo</h1>
      <p className="text-14 text-tinta-suave mt-1">Ya tenemos con qué calcular.</p>

      <div className="panel p-5 mt-5">
        <p className="text-12 text-tinta-suave">Tu score de arranque</p>
        <p className="cifra font-titulo text-56 font-semibold leading-none">
          {respuesta.score_actualizado}
        </p>

        <p className="text-14 mt-4">
          Todavía no registras gastos, así que este número es optimista: el
          promedio de tu gasto variable arranca en cero. Conforme anotes lo que
          gastas, se vuelve realista.
        </p>

        <dl className="grid grid-cols-3 gap-3 mt-5 pt-4 border-t border-linea">
          <Resumen etiqueta="Disponible" valor={mxn(respuesta.liquidez)} />
          <Resumen etiqueta="Ingresos" valor={String(respuesta.ingresos_creados)} />
          <Resumen etiqueta="Tarjetas" valor={String(respuesta.tarjetas_creadas)} />
        </dl>
      </div>

      <Boton tono="primario" grande className="w-full mt-5" onClick={onSeguir}>
        Ver mi resumen
      </Boton>
    </div>
  )
}

function Resumen({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-12 text-tinta-suave">{etiqueta}</dt>
      <dd className="cifra text-16 font-medium">{valor}</dd>
    </div>
  )
}
