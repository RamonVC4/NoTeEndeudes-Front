/**
 * El catálogo de categorías, una sola vez para toda la app.
 *
 * Antes vivían hardcodeadas en tipos.ts con mayúscula y acento ("Comida"), y
 * no las validaba nadie. Ahora son un catálogo en la base: se piden a
 * GET /categorias, se MANDA la `clave` ("comida") y se MUESTRA el `nombre`.
 *
 * Va en Context y no en cada pantalla porque es una lectura de baja frecuencia
 * que necesitan ramas lejanas del árbol —el wizard, el alta de movimientos y
 * los gastos fijos— y volver a pedirla en cada una es una petición de más por
 * pantalla para un dato que no cambia durante la sesión.
 *
 * El endpoint es público, así que carga antes del login.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react'
import type { ReactNode } from 'react'
import * as api from './api'
import type { CategoriaResumen } from './tipos'

const LLAVE_CACHE = 'categorias'

interface Valor {
  categorias: CategoriaResumen[]
  cargando: boolean
  /** El nombre para pintar a partir de la clave; la clave misma si no está. */
  nombreDe: (clave: string | null | undefined) => string
}

const Ctx = createContext<Valor | null>(null)

/** Lo que quedó de la sesión anterior, para no pintar selects vacíos al arrancar. */
function deCache(): CategoriaResumen[] {
  try {
    const crudo = sessionStorage.getItem(LLAVE_CACHE)
    return crudo ? (JSON.parse(crudo) as CategoriaResumen[]) : []
  } catch {
    return []
  }
}

export function CategoriasProvider({ children }: { children: ReactNode }) {
  const [categorias, setCategorias] = useState<CategoriaResumen[]>(deCache)
  const [cargando, setCargando] = useState(categorias.length === 0)

  useEffect(() => {
    let vivo = true
    api.categorias()
      .then(r => {
        if (!vivo) return
        setCategorias(r.data)
        try { sessionStorage.setItem(LLAVE_CACHE, JSON.stringify(r.data)) } catch { /* modo privado */ }
      })
      // Sin catálogo la app sigue: los selects quedan con lo cacheado, y si no
      // hay nada, el 422 del backend traerá las claves válidas en detalle.validas.
      .catch(() => { /* silencio a propósito */ })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [])

  const nombreDe = useCallback(
    (clave: string | null | undefined) =>
      categorias.find(c => c.clave === clave)?.nombre ?? clave ?? '',
    [categorias],
  )

  const valor = useMemo(
    () => ({ categorias, cargando, nombreDe }),
    [categorias, cargando, nombreDe],
  )

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export function useCategorias(): Valor {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCategorias fuera de CategoriasProvider')
  return v
}

/** La clave por defecto de un formulario nuevo. */
export const CLAVE_POR_DEFECTO = 'otros'