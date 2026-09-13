import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react'
import type { ReactNode } from 'react'
import * as api from '../lib/api'
import { limpiarCacheIA } from '../lib/ia'
import type { UsuarioResumen } from '../lib/tipos'

interface Sesion {
  usuario: UsuarioResumen | null
  cargando: boolean
  entrarDemo: () => Promise<UsuarioResumen>
  entrar: (email: string, password: string) => Promise<UsuarioResumen>
  registrarse: (nombre: string, email: string, password: string) => Promise<UsuarioResumen>
  salir: () => void
  /** Tras completar el onboarding, para no volver a pedir /auth/me. */
  marcarOnboardingCompleto: () => void
  /** Relee /auth/me. saldo_disponible y version cambian con cada
   *  movimiento, y version es lo que PUT /usuarios/me/liquidez exige. */
  refrescar: () => Promise<void>
}

const Contexto = createContext<Sesion | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioResumen | null>(null)
  const [cargando, setCargando] = useState(true)

  // Lo primero que corre al montar la app: el login devuelve el nombre una
  // sola vez y al recargar eso ya se perdió.
  useEffect(() => {
    if (!localStorage.getItem('token')) {
      setCargando(false)
      return
    }
    let vivo = true
    api.yo()
      .then(u => { if (vivo) setUsuario(u) })
      .catch(() => {
        // Un 401 ya limpió el token en el cliente; cualquier otro error deja
        // al usuario fuera y con la pantalla de login, no en blanco.
        if (vivo) setUsuario(null)
      })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [])

  const trasEntrar = useCallback(async (token: string) => {
    // Los textos de IA de la cuenta anterior no deben sobrevivir al cambio.
    limpiarCacheIA()
    localStorage.setItem('token', token)
    const u = await api.yo()
    setUsuario(u)
    return u
  }, [])

  const entrarDemo = useCallback(async () => {
    const { token } = await api.entrarDemo()
    return trasEntrar(token)
  }, [trasEntrar])

  const entrar = useCallback(async (email: string, password: string) => {
    const { token } = await api.login({ email, password })
    return trasEntrar(token)
  }, [trasEntrar])

  const registrarse = useCallback(
    async (nombre: string, email: string, password: string) => {
      const { token } = await api.registro({ nombre, email, password })
      return trasEntrar(token)
    }, [trasEntrar])

  const salir = useCallback(() => {
    localStorage.removeItem('token')
    limpiarCacheIA()
    setUsuario(null)
  }, [])

  const refrescar = useCallback(async () => {
    try { setUsuario(await api.yo()) } catch { /* un 401 ya mando a /login */ }
  }, [])

  const marcarOnboardingCompleto = useCallback(() => {
    setUsuario(u => (u ? { ...u, onboarding_completo: true } : u))
  }, [])

  const valor = useMemo<Sesion>(() => ({
    usuario, cargando, entrarDemo, entrar, registrarse, salir,
    marcarOnboardingCompleto, refrescar,
  }), [usuario, cargando, entrarDemo, entrar, registrarse, salir,
       marcarOnboardingCompleto, refrescar])

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useSesion(): Sesion {
  const ctx = useContext(Contexto)
  if (!ctx) throw new Error('useSesion fuera de AuthProvider')
  return ctx
}