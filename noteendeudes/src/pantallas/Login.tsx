import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useSesion } from '../auth/AuthContext'
import Boton from '../componentes/Boton'
import Campo from '../componentes/Campo'
import { ErrorLinea, camposConError } from '../componentes/ErrorApi'
import { MOCK } from '../lib/api'

type Modo = 'demo' | 'entrar' | 'registro'

export default function Login() {
  const { entrarDemo, entrar, registrarse } = useSesion()
  const navegar = useNavigate()

  const [modo, setModo] = useState<Modo>('demo')
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [errorPassword, setErrorPassword] = useState<string | null>(null)

  const campos = camposConError(error)

  async function correr(accion: () => Promise<{ onboarding_completo: boolean }>) {
    setEnviando(true)
    setError(null)
    try {
      const u = await accion()
      navegar(u.onboarding_completo ? '/dashboard' : '/onboarding', { replace: true })
    } catch (e) {
      setError(e)
    } finally {
      setEnviando(false)
    }
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (modo === 'registro' && password.length < 8) {
      setErrorPassword('La contraseña necesita al menos 8 caracteres')
      return
    }
    setErrorPassword(null)
    correr(() => modo === 'registro'
      ? registrarse(nombre, email, password)
      : entrar(email, password))
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-14 text-tinta-suave hover:text-tinta mb-4"
        >
          <ArrowLeft size={16} />
          Qué es esto
        </Link>

        <h1 className="font-titulo text-32">No te endeudes</h1>
        <p className="text-14 text-tinta-suave mt-1">
          Antes de comprar, mira qué le pasa a tu dinero.
        </p>

        <div className="panel p-5 mt-6">
          <Boton
            tono="primario"
            grande
            className="w-full"
            cargando={enviando && modo === 'demo'}
            onClick={() => { setModo('demo'); correr(entrarDemo) }}
          >
            Entrar como demo
          </Boton>
          <p className="text-12 text-tinta-suave mt-2">
            Cuenta con datos de ejemplo{MOCK ? ', sin conexión al servidor' : ''}.
          </p>

          <div className="flex items-center gap-3 my-5">
            <span className="h-px flex-1 bg-linea" />
            <span className="text-12 text-tinta-suave">o con tu cuenta</span>
            <span className="h-px flex-1 bg-linea" />
          </div>

          <div className="flex gap-1 mb-4" role="tablist">
            <PestanaModo activo={modo !== 'registro'} onClick={() => setModo('entrar')}>
              Iniciar sesión
            </PestanaModo>
            <PestanaModo activo={modo === 'registro'} onClick={() => setModo('registro')}>
              Crear cuenta
            </PestanaModo>
          </div>

          <form onSubmit={enviar} className="space-y-3" noValidate>
            {modo === 'registro' && (
              <Campo
                etiqueta="Tu nombre"
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                autoComplete="name"
                required
                error={campos.nombre}
              />
            )}
            <Campo
              etiqueta="Correo"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              required
              error={campos.email}
            />
            <Campo
              etiqueta="Contraseña"
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setErrorPassword(null) }}
              autoComplete={modo === 'registro' ? 'new-password' : 'current-password'}
              required
              error={errorPassword ?? campos.password}
              ayuda={modo === 'registro' ? 'Mínimo 8 caracteres' : undefined}
            />

            {error != null && <ErrorLinea error={error} />}

            <Boton
              type="submit"
              tono="secundario"
              className="w-full"
              cargando={enviando && modo !== 'demo'}
            >
              {modo === 'registro' ? 'Crear cuenta' : 'Entrar'}
            </Boton>
          </form>
        </div>

        <p className="text-12 text-tinta-suave mt-4">
          Nunca te pedimos el número de tu tarjeta.
        </p>
      </div>
    </div>
  )
}

function PestanaModo({
  activo, onClick, children,
}: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={activo}
      onClick={onClick}
      className={[
        'text-14 px-3 py-1.5 rounded-md',
        activo ? 'bg-papel font-medium' : 'text-tinta-suave hover:text-tinta',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
