import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useSesion } from './auth/AuthContext'
import RutaProtegida from './auth/RutaProtegida'
import { CategoriasProvider } from './lib/categorias'
import Marco from './componentes/Marco'
import { CargandoPanel } from './componentes/Cargando'
import Bienvenida from './pantallas/Bienvenida'
import Login from './pantallas/Login'
import Onboarding from './pantallas/Onboarding'
import Dashboard from './pantallas/Dashboard'
import Confirmar from './pantallas/Confirmar'
import GastosFijos from './pantallas/GastosFijos'
import Simulador from './pantallas/Simulador'
import Deuda from './pantallas/Deuda'
import Movimientos from './pantallas/Movimientos'
import Tarjetas from './pantallas/Tarjetas'

/** Con sesión abierta, la portada y /login no tienen nada que hacer. */
function SoloInvitados({ children }: { children: React.ReactNode }) {
  const { usuario, cargando } = useSesion()
  if (cargando) {
    return (
      <div className="mx-auto max-w-[380px] p-4 pt-20">
        <CargandoPanel lineas={4} />
      </div>
    )
  }
  if (usuario) {
    return <Navigate to={usuario.onboarding_completo ? '/dashboard' : '/onboarding'} replace />
  }
  return <>{children}</>
}

function Pantalla({ children }: { children: React.ReactNode }) {
  return (
    <RutaProtegida>
      <Marco>{children}</Marco>
    </RutaProtegida>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <CategoriasProvider>
        <Routes>
          <Route path="/" element={<SoloInvitados><Bienvenida /></SoloInvitados>} />
          <Route path="/login" element={<SoloInvitados><Login /></SoloInvitados>} />
          <Route
            path="/onboarding"
            element={<RutaProtegida><Onboarding /></RutaProtegida>}
          />
          <Route path="/dashboard" element={<Pantalla><Dashboard /></Pantalla>} />
          <Route path="/confirmar" element={<Pantalla><Confirmar /></Pantalla>} />
          <Route path="/simulador" element={<Pantalla><Simulador /></Pantalla>} />
          <Route path="/deuda" element={<Pantalla><Deuda /></Pantalla>} />
          <Route path="/movimientos" element={<Pantalla><Movimientos /></Pantalla>} />
          <Route path="/tarjetas" element={<Pantalla><Tarjetas /></Pantalla>} />
          <Route path="/gastos-fijos" element={<Pantalla><GastosFijos /></Pantalla>} />
          {/* Sin sesión, la portada explica de qué va esto; con sesión, rebota
              al Resumen. Una sola puerta para los dos casos. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </CategoriasProvider>
    </AuthProvider>
  )
}
