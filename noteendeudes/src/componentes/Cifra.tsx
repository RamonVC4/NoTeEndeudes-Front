import { conSigno, mxn, pct, pctYa } from '../lib/formato'

type Formato = 'mxn' | 'pct' | 'pctYa' | 'entero' | 'delta'
type Tamano = 12 | 14 | 16 | 20 | 32 | 56

interface Props {
  valor: number | null | undefined
  formato?: Formato
  tamano?: Tamano
  /** Token de color; si se omite, hereda el color del texto. */
  color?: string
  titulo?: boolean
  className?: string
}

const CLASE_TAMANO: Record<Tamano, string> = {
  12: 'text-12', 14: 'text-14', 16: 'text-16',
  20: 'text-20', 32: 'text-32', 56: 'text-56',
}

function texto(valor: number, formato: Formato): string {
  switch (formato) {
    case 'mxn': return mxn(valor)
    case 'pct': return pct(valor)
    case 'pctYa': return pctYa(valor)
    case 'delta': return conSigno(valor)
    default: return String(valor)
  }
}

/** Número tabular. Es el único lugar donde se decide cómo se ve una cifra. */
export default function Cifra({
  valor, formato = 'mxn', tamano = 16, color, titulo = false, className = '',
}: Props) {
  if (valor === null || valor === undefined) {
    return <span className={`cifra text-tinta-suave ${CLASE_TAMANO[tamano]} ${className}`}>—</span>
  }
  return (
    <span
      className={[
        'cifra', CLASE_TAMANO[tamano],
        titulo ? 'font-titulo font-semibold' : 'font-medium',
        className,
      ].join(' ')}
      style={color ? { color } : undefined}
    >
      {texto(valor, formato)}
    </span>
  )
}