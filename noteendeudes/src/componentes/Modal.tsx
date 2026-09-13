import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

interface Props {
  titulo: string
  onCerrar: () => void
  children: ReactNode
}

export default function Modal({ titulo, onCerrar, children }: Props) {
  const caja = useRef<HTMLDivElement>(null)

  useEffect(() => {
    caja.current?.querySelector<HTMLElement>('input, button, select')?.focus()
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    document.addEventListener('keydown', alTeclear)
    return () => document.removeEventListener('keydown', alTeclear)
  }, [onCerrar])

  return (
    <div
      className="fixed inset-0 z-40 bg-tinta/45 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onCerrar}
    >
      <div
        ref={caja}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={e => e.stopPropagation()}
        className="bg-superficie w-full sm:max-w-[420px] rounded-t-xl sm:rounded-xl p-5 pb-7 sm:pb-5
                   max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 className="font-titulo text-20">{titulo}</h2>
          <button onClick={onCerrar} aria-label="Cerrar" className="text-tinta-suave shrink-0">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}