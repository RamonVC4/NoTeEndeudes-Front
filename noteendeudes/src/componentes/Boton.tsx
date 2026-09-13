import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Tono = 'primario' | 'secundario' | 'fantasma'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  tono?: Tono
  grande?: boolean
  cargando?: boolean
  children: ReactNode
}

const ESTILO: Record<Tono, string> = {
  primario:
    'bg-accion text-white border border-transparent hover:brightness-110',
  secundario:
    'bg-superficie text-tinta border border-linea hover:border-tinta-suave',
  fantasma:
    'bg-transparent text-accion border border-transparent hover:underline',
}

export default function Boton({
  tono = 'secundario', grande = false, cargando = false,
  className = '', disabled, children, ...resto
}: Props) {
  return (
    <button
      {...resto}
      disabled={disabled || cargando}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-md font-medium',
        'transition-[filter,border-color] disabled:opacity-45 disabled:cursor-not-allowed',
        grande ? 'px-5 py-3 text-16' : 'px-3.5 py-2 text-14',
        ESTILO[tono],
        className,
      ].join(' ')}
    >
      {cargando ? 'Un momento…' : children}
    </button>
  )
}