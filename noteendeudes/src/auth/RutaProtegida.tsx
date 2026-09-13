import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useSesion } from './AuthContext'
import { CargandoPanel } from '../componentes/Cargando'

/**
 * Sin token o con token vencido → login. Con onboarding pendiente → wizard,
 * salvo que ya estemos en él.
 */
export default function RutaProtegida({ children }: { children: ReactNode }) {
  const { usuario, cargando } = useSesion()
  const { pathname } = useLocation()

  if (cargando) {
    return (
      <div className="mx-auto max-w-[1100px] p-4 space-y-4">
        <CargandoPanel lineas={4} />
        <CargandoPanel lineas={2} />
      </div>
    )
  }

  if (!usuario) return <Navigate to="/login" replace />

  if (!usuario.onboarding_completo && pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }

  return <>{children}</>
}
