/**
 * Pantalla pública. Es lo primero que ve alguien que llega sin sesión: qué es
 * esto, cómo lee tu dinero y qué no le pedimos nunca.
 *
 * Se respeta la misma regla que dentro de la app: el chasis es neutro y el
 * color saturado solo aparece cuando el dinero dice algo. Aquí el único color
 * lo pinta el ejemplo del score, y sale de `colorBanda()`, no de esta pantalla.
 *
 * Los números del ejemplo no se calculan aquí ni se inventan: son los del seed
 * demo documentado en `API.md` (`GET /score` y `POST /simulaciones/compra` con
 * la laptop de $15,000 a [3, 6, 12]), y van marcados como ejemplo en la UI. Si
 * el seed cambia, este bloque se actualiza a mano; por eso vive en una sola
 * constante y no repartido por el archivo.
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight, CalendarCheck, CalendarClock, Calculator, EyeOff, ShieldCheck,
  TrendingDown,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useSesion } from '../auth/AuthContext'
import { bandaDeScore, colorBanda } from '../lib/formato'
import type { Componente } from '../lib/tipos'
import Boton from '../componentes/Boton'
import BarraComponente from '../componentes/BarraComponente'
import Cifra from '../componentes/Cifra'
import { ErrorLinea } from '../componentes/ErrorApi'

/** Seed demo, tal como lo documenta API.md. Ver el comentario de arriba. */
const EJEMPLO = {
  score: 80,
  banda: 'Saludable',
  color: 'verde',
  componentes: { liquidez: 63, deuda: 75, utilizacion: 92, flujo: 100 },
  pesos: { liquidez: 30, deuda: 30, utilizacion: 20, flujo: 20 },
  compra: {
    monto: 15000,
    tarjeta: 'BBVA',
    pago_mensual: 1250,
    holgura_despues: 7000,
    score_despues: 61,
    delta: -19,
  },
  /** Mensualidad de cada plazo que ofrece el comercio: monto entre meses. */
  formas: [
    { etiqueta: 'De contado', mensual: null },
    { etiqueta: '3 meses sin intereses', mensual: 5000 },
    { etiqueta: '6 meses sin intereses', mensual: 2500 },
    { etiqueta: '12 meses sin intereses', mensual: 1250 },
  ],
} as const

const ORDEN: Componente[] = ['liquidez', 'deuda', 'utilizacion', 'flujo']

export default function Bienvenida() {
  const { entrarDemo } = useSesion()
  const navegar = useNavigate()
  const [entrando, setEntrando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function verDemo() {
    setEntrando(true)
    setError(null)
    try {
      const u = await entrarDemo()
      navegar(u.onboarding_completo ? '/dashboard' : '/onboarding', { replace: true })
    } catch (e) {
      setError(e)
      setEntrando(false)
    }
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 bg-superficie border-b border-linea">
        <div className="mx-auto max-w-[1100px] px-4 py-3 flex items-center justify-between gap-3">
          <p className="font-titulo text-16 font-semibold leading-tight">No te endeudes</p>
          <Link to="/login" className="text-14 text-accion rounded-md px-2 py-2 -my-1 hover:underline">
            Iniciar sesión
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-4 py-8 md:py-12 space-y-10 md:space-y-14">
        <Portada entrando={entrando} error={error} onDemo={verDemo} />
        <Score />
        <Herramientas />
        <Limites />
        <Cierre entrando={entrando} onDemo={verDemo} />
      </main>

      <footer className="border-t border-linea bg-superficie">
        <div className="mx-auto max-w-[1100px] px-4 py-5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-12 text-tinta-suave">
            No te endeudes — salud financiera personal, en pesos mexicanos.
          </p>
          <Link to="/login" className="text-12 text-accion ml-auto py-2.5 -my-2.5 hover:underline">
            Entrar a mi cuenta
          </Link>
        </div>
      </footer>
    </div>
  )
}

/* ------------------------------------------------------------------ portada
   Lo primero que se ve es el gesto que define el producto: una compra puesta
   frente al dinero que ya tienes. No un eslogan. */
function Portada({
  entrando, error, onDemo,
}: { entrando: boolean; error: unknown; onDemo: () => void }) {
  return (
    <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-10 lg:items-start">
      <div>
        <h1 className="font-titulo text-32 md:text-56 max-w-[16ch]">
          Antes de comprar, mira qué le pasa a tu dinero.
        </h1>
        <p className="text-16 text-tinta-suave mt-4 max-w-[52ch]">
          Pones el monto y los meses que te ofrecen. Te decimos con qué pagarlo,
          cuánto te queda libre después y cuánto se mueve tu salud financiera.
          Sin promesas: los mismos números que ya traes en tus cuentas.
        </p>

        <div className="flex flex-wrap gap-2 mt-6">
          <Boton tono="primario" grande cargando={entrando} onClick={onDemo}>
            Ver la demo
            <ArrowRight size={17} />
          </Boton>
          <Link to="/login">
            <Boton tono="secundario" grande type="button">
              Usar mi cuenta
            </Boton>
          </Link>
        </div>

        {error != null && (
          <div className="mt-3">
            <ErrorLinea error={error} />
          </div>
        )}

        <p className="text-12 text-tinta-suave mt-3">
          La demo abre una cuenta con datos de ejemplo. No pide correo ni tarjeta.
        </p>
      </div>

      <EjemploCompra />
    </section>
  )
}

/** El simulador, con el caso del seed demo ya resuelto. */
function EjemploCompra() {
  const { compra } = EJEMPLO
  const colorAntes = colorBanda(EJEMPLO.color)
  const bandaDespues = bandaDeScore(compra.score_despues)
  const colorDespues = colorBanda(bandaDespues.color)

  return (
    <div className="panel p-5">
      <p className="text-12 text-tinta-suave">Ejemplo con la cuenta demo</p>
      <p className="text-16 font-medium mt-0.5">
        Una laptop de <Cifra valor={compra.monto} tamano={16} /> a 3, 6 o 12 meses
      </p>

      <div className="border-t border-linea mt-4 pt-4">
        <p className="text-12 text-tinta-suave">Cómo te conviene pagarla</p>
        <p className="font-titulo text-20 font-semibold mt-1">
          12 meses sin intereses con {compra.tarjeta}
        </p>
        <p className="text-14 text-tinta-suave mt-1">
          <Cifra valor={compra.pago_mensual} tamano={14} /> al mes, y te quedan{' '}
          <Cifra valor={compra.holgura_despues} tamano={14} /> de holgura.
        </p>
      </div>

      <div className="border-t border-linea mt-4 pt-4">
        <p className="text-12 text-tinta-suave">Tu salud financiera después</p>
        <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1">
          <Cifra valor={EJEMPLO.score} formato="entero" tamano={32} titulo color={colorAntes} />
          <ArrowRight size={16} className="text-tinta-suave shrink-0" aria-label="pasa a" />
          <Cifra
            valor={compra.score_despues}
            formato="entero"
            tamano={32}
            titulo
            color={colorDespues}
          />
          <Cifra valor={compra.delta} formato="delta" tamano={14} color={colorDespues} />
        </div>
        <p className="text-12 text-tinta-suave mt-1">
          De {EJEMPLO.banda} a {bandaDespues.banda}. Se puede — y ya sabes lo que cuesta.
        </p>
      </div>

      <ul className="border-t border-linea mt-4 pt-3 space-y-2">
        {EJEMPLO.formas.map(f => (
          <li key={f.etiqueta} className="flex items-baseline justify-between gap-3">
            <span className="text-14 min-w-0">{f.etiqueta}</span>
            <span className="shrink-0">
              <Cifra valor={f.mensual ?? compra.monto} tamano={14} />
              <span className="text-12 text-tinta-suave">
                {f.mensual === null ? ' de una vez' : ' al mes'}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* -------------------------------------------------------------------- score
   Reusa la misma barra que pinta el Resumen, con los valores del seed demo: el
   punto es que el número se abre y se explica, no que se vea bonito. */
function Score() {
  const color = colorBanda(EJEMPLO.color)

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:gap-10 lg:items-start">
      <div>
        <h2 className="font-titulo text-20">Un número que se puede abrir</h2>
        <p className="text-14 text-tinta-suave mt-2 max-w-[46ch]">
          Tu salud financiera es un 0 a 100, pero nunca se queda en el número: se
          parte en cuatro piezas, cada una con lo que pesa. Cuando baja, puedes
          ver cuál se movió y por qué.
        </p>
        <p className="text-12 text-tinta-suave mt-3">
          Saludable 80+ · Estable 60–79 · En riesgo 40–59 · Crítico menos de 40.
        </p>
      </div>

      <div className="panel p-5">
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <p className="text-12 text-tinta-suave">Salud financiera · cuenta demo</p>
            <Cifra valor={EJEMPLO.score} formato="entero" tamano={56} titulo color={color} />
          </div>
          <div className="pb-2">
            <p className="text-16 font-medium" style={{ color }}>
              {EJEMPLO.banda}
            </p>
            <p className="text-12 text-tinta-suave">de 100 puntos</p>
          </div>
        </div>

        <div className="border-t border-linea mt-5 pt-5 space-y-4">
          {ORDEN.map(k => (
            <BarraComponente
              key={k}
              componente={k}
              valor={EJEMPLO.componentes[k]}
              peso={EJEMPLO.pesos[k]}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------- herramientas
   Los mismos íconos que usa el rail de navegación: quien entre después va a
   reconocer estas cuatro secciones por la figura, no por el texto. */
interface Herramienta {
  Icono: LucideIcon
  titulo: string
  texto: string
}

const HERRAMIENTAS: Herramienta[] = [
  {
    Icono: Calculator,
    titulo: '¿Me conviene?',
    texto:
      'Le dices el monto y con qué tarjetas te lo ofrecen en esa tienda. Compara el efectivo, el crédito y cada plazo de meses, y ordena las formas de pago por la que te deja mejor parado.',
  },
  {
    Icono: TrendingDown,
    titulo: 'Qué pagar primero',
    texto:
      'Con varias tarjetas encima, el orden importa. Te dice cuál atacar antes y cuánto interés te ahorras por hacerlo en ese orden.',
  },
  {
    Icono: CalendarCheck,
    titulo: '¿Qué ya pasó?',
    texto:
      'Lo que se supone que ya se cobró, en una lista para confirmar de un toque. Tu saldo real deja de ser una adivinanza.',
  },
  {
    Icono: CalendarClock,
    titulo: 'Lo que pagas siempre',
    texto:
      'Renta, luz, suscripciones. La luz bimestral de $900 pesa $450 al mes en tus obligaciones y cae completa el mes que toca: las dos cosas se ven por separado.',
  },
]

function Herramientas() {
  return (
    <section>
      <h2 className="font-titulo text-20">Lo que haces aquí</h2>
      <div className="grid gap-4 mt-4 md:grid-cols-2">
        {HERRAMIENTAS.map(({ Icono, titulo, texto }) => (
          <div key={titulo} className="panel p-5">
            <div className="flex items-center gap-2.5">
              <Icono size={18} className="text-accion shrink-0" />
              <h3 className="font-titulo text-16">{titulo}</h3>
            </div>
            <p className="text-14 text-tinta-suave mt-2">{texto}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ límites
   Lo que NO hacemos. Va en la presentación a propósito: es una decisión de
   producto, no una letra chiquita. */
const LIMITES = [
  {
    Icono: ShieldCheck,
    titulo: 'Nunca te pedimos el número de tu tarjeta',
    texto:
      'Ningún formulario de la app lo tiene. Para calcular basta con el límite, la tasa y los días de corte y de pago.',
  },
  {
    Icono: EyeOff,
    titulo: 'No nos conectamos a tu banco',
    texto:
      'No hay contraseñas de banca en línea ni movimientos que se jalan solos. Tú decides qué entra.',
  },
]

function Limites() {
  return (
    <section className="panel p-5 md:p-6">
      <h2 className="font-titulo text-20">Lo que no hacemos</h2>
      <div className="grid gap-5 mt-4 md:grid-cols-2">
        {LIMITES.map(({ Icono, titulo, texto }) => (
          <div key={titulo} className="flex gap-3">
            <Icono size={18} className="text-tinta-suave shrink-0 mt-0.5" />
            <div className="min-w-0">
              <h3 className="font-titulo text-16">{titulo}</h3>
              <p className="text-14 text-tinta-suave mt-1">{texto}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-14 text-tinta-suave border-t border-linea mt-5 pt-4">
        Y una regla que se nota en toda la pantalla: el color fuerte solo aparece
        cuando tu dinero lo dicta. Si ves verde, ámbar o rojo, es tu situación
        hablando, no un adorno.
      </p>
    </section>
  )
}

/* ------------------------------------------------------------------- cierre */
function Cierre({ entrando, onDemo }: { entrando: boolean; onDemo: () => void }) {
  return (
    <section className="panel p-5 md:p-6 flex flex-wrap items-center gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h2 className="font-titulo text-20">Míralo con datos ya cargados</h2>
        <p className="text-14 text-tinta-suave mt-1 max-w-[52ch]">
          La cuenta demo trae tarjetas, gastos fijos y movimientos de todo un año.
          Entras y el simulador ya tiene con qué contestarte.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 ml-auto">
        <Boton tono="primario" grande cargando={entrando} onClick={onDemo}>
          Ver la demo
          <ArrowRight size={17} />
        </Boton>
        <Link to="/login">
          <Boton tono="secundario" grande type="button">
            Crear cuenta
          </Boton>
        </Link>
      </div>
    </section>
  )
}
