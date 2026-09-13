import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  CalendarCheck, CalendarClock, Calculator, CreditCard, Gauge, LogOut,
  MoreHorizontal, Receipt, TrendingDown, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useSesion } from '../auth/AuthContext'
import { MOCK } from '../lib/api'

interface Destino {
  a: string
  nombre: string
  corto: string
  Icono: LucideIcon
}

const DESTINOS: Destino[] = [
  { a: '/dashboard', nombre: 'Resumen', corto: 'Inicio', Icono: Gauge },
  { a: '/confirmar', nombre: '¿Qué ya pasó?', corto: 'Confirmar', Icono: CalendarCheck },
  { a: '/simulador', nombre: '¿Me conviene?', corto: 'Simular', Icono: Calculator },
  { a: '/deuda', nombre: 'Qué pagar primero', corto: 'Deuda', Icono: TrendingDown },
  { a: '/movimientos', nombre: 'Movimientos', corto: 'Gastos', Icono: Receipt },
  { a: '/tarjetas', nombre: 'Tarjetas', corto: 'Tarjetas', Icono: CreditCard },
  { a: '/gastos-fijos', nombre: 'Lo que pagas siempre', corto: 'Fijos', Icono: CalendarClock },
]

// En móvil caben cuatro; el resto vive en "Más". Confirmar entra a la barra
// porque es el gesto que se repite a diario: registrar un gasto ya tiene
// entrada propia desde el Resumen.
const EN_BARRA = DESTINOS.slice(0, 4)

export default function Marco({ children }: { children: ReactNode }) {
  const { usuario, salir } = useSesion()
  const [masAbierto, setMasAbierto] = useState(false)

  return (
    <div className="min-h-screen md:flex">
      {/* Rail de escritorio */}
      <nav
        aria-label="Secciones"
        className="hidden md:flex md:flex-col md:w-[220px] md:shrink-0 md:h-screen md:sticky md:top-0
                   border-r border-linea bg-superficie px-3 py-4"
      >
        <div className="px-2 pb-4">
          <p className="font-titulo text-16 font-semibold leading-tight flex items-center gap-2">
            <img src="/icons/icon-192.png" alt="" className="size-7 shrink-0" />
            No te endeudes
          </p>
          {usuario && (
            <p className="text-12 text-tinta-suave mt-0.5 truncate">{usuario.nombre}</p>
          )}
          <Marcas esDemo={usuario?.es_demo} />
        </div>

        <ul className="space-y-0.5 flex-1">
          {DESTINOS.map(({ a, nombre, Icono }) => (
            <li key={a}>
              <NavLink to={a} className={enlaceRail}>
                <Icono size={17} className="shrink-0" />
                <span className="truncate">{nombre}</span>
              </NavLink>
            </li>
          ))}
        </ul>

        <button
          onClick={salir}
          className="flex items-center gap-2 px-2.5 py-2 rounded-md text-14 text-tinta-suave
                     hover:text-tinta hover:bg-papel text-left"
        >
          <LogOut size={17} />
          Cerrar sesión
        </button>
      </nav>

      {/* Cabecera de móvil */}
      <header className="md:hidden sticky top-0 z-20 bg-superficie border-b border-linea px-4 py-3
                         flex items-center justify-between">
        <div className="min-w-0 flex items-center gap-2">
          <img src="/icons/icon-192.png" alt="" className="size-8 shrink-0" />
          <div className="min-w-0">
            <p className="font-titulo text-16 font-semibold leading-tight truncate">
              No te endudes
            </p>
            {usuario && <p className="text-12 text-tinta-suave truncate">{usuario.nombre}</p>}
          </div>
        </div>
        <Marcas esDemo={usuario?.es_demo} />
      </header>

      <div className="flex-1 min-w-0">
        <main className="mx-auto max-w-[1100px] px-4 py-5 pb-24 md:pb-10">{children}</main>
      </div>

      {/* Tab bar de móvil */}
      <nav
        aria-label="Secciones"
        className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-superficie border-t border-linea
                   grid grid-cols-5"
      >
        {EN_BARRA.map(({ a, corto, Icono }) => (
          <NavLink key={a} to={a} className={enlaceTab}>
            <Icono size={19} />
            <span className="text-12">{corto}</span>
          </NavLink>
        ))}
        <button
          onClick={() => setMasAbierto(true)}
          className="flex flex-col items-center gap-0.5 py-2 text-tinta-suave"
          aria-label="Más secciones"
        >
          <MoreHorizontal size={19} />
          <span className="text-12">Más</span>
        </button>
      </nav>

      {masAbierto && (
        <div className="md:hidden fixed inset-0 z-30 bg-tinta/40 flex items-end"
             onClick={() => setMasAbierto(false)}>
          <div
            className="bg-superficie w-full rounded-t-xl p-4 pb-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="font-titulo text-16 font-semibold">Más</p>
              <button onClick={() => setMasAbierto(false)} aria-label="Cerrar" className="p-2 -m-2">
                <X size={20} />
              </button>
            </div>
            {DESTINOS.slice(4).map(({ a, nombre, Icono }) => (
              <NavLink
                key={a} to={a}
                onClick={() => setMasAbierto(false)}
                className="flex items-center gap-3 py-3 border-b border-linea text-16"
              >
                <Icono size={18} />
                {nombre}
              </NavLink>
            ))}
            <button
              onClick={salir}
              className="flex items-center gap-3 py-3 text-16 text-tinta-suave w-full text-left"
            >
              <LogOut size={18} />
              Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Marcas({ esDemo }: { esDemo?: boolean }) {
  if (!esDemo && !MOCK) return null
  return (
    <div className="flex gap-1.5 mt-1.5">
      {esDemo && <Marca texto="demo" />}
      {MOCK && <Marca texto="sin conexión" />}
    </div>
  )
}

function Marca({ texto }: { texto: string }) {
  return (
    <span className="text-12 leading-tight text-tinta-suave border border-linea rounded px-1.5 py-0.5">
      {texto}
    </span>
  )
}

const enlaceRail = ({ isActive }: { isActive: boolean }) =>
  [
    'flex items-center gap-2.5 px-2.5 py-2 rounded-md text-14',
    isActive
      ? 'bg-papel text-tinta font-medium'
      : 'text-tinta-suave hover:text-tinta hover:bg-papel',
  ].join(' ')

const enlaceTab = ({ isActive }: { isActive: boolean }) =>
  [
    'flex flex-col items-center gap-0.5 py-2',
    isActive ? 'text-accion' : 'text-tinta-suave',
  ].join(' ')