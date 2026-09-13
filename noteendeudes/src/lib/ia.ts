// lib/ia.ts
// Los tres servicios de IA, que ahora son tres llamadas normales al backend.
//
// Antes esto era lib/gemini.ts y hablaba con Google directamente: la API key
// salía de VITE_GEMINI_API_KEY, o sea que Vite la metía en el bundle y
// cualquiera con las devtools abiertas se la llevaba. Ahora la llave vive en el
// .env del servidor y el navegador no la ve nunca.
//
// De paso se fue de aquí todo lo que no era del front: la lista de modelos de
// respaldo, el base64 del PDF, el parseo del JSON y las ~90 líneas de reglas
// financieras que normalizaban lo leído. Eso vive en el backend
// (app/domain/extraccion.py) y ahí sí tiene pruebas.
import { get, post, subir } from './api'
import type {
  AnalisisCompraResponse, ExplicacionDeudaResponse, ExtraccionResponse,
  ModoPago, SimulacionRequest,
} from './tipos'

export type {
  AnalisisCompraResponse, ExplicacionDeudaResponse, ExtraccionResponse, PlanLeido,
} from './tipos'

/** El backend rechaza lo mismo; esto solo evita subir 15 MB para nada. */
const MAX_BYTES = 15 * 1024 * 1024

export class ArchivoInvalido extends Error {}

// ------------------------------------------------- 1. extraccion de PDF
/**
 * Sube el estado de cuenta y devuelve los términos listos para el formulario.
 *
 * NO GUARDA NADA: esto prellena la pantalla. Lo que se guarda es el PATCH que
 * manda el usuario cuando ya revisó los números.
 *
 * `modo` decide cuál de los dos pagos impresos se prellena, pero la respuesta
 * trae los dos: cambiar de modo en el formulario no vuelve a pedir el PDF.
 */
export async function extraerEstadoDeCuenta(
  tarjetaId: string, pdf: File, modo: ModoPago = 'minimo',
): Promise<ExtraccionResponse> {
  // Estas dos se comprueban aquí y en el servidor. Aquí, para fallar antes de
  // gastar la subida; allá, porque el cliente no es de fiar.
  if (pdf.type !== 'application/pdf')
    throw new ArchivoInvalido('El archivo debe ser un PDF')
  if (pdf.size > MAX_BYTES)
    throw new ArchivoInvalido('El PDF pesa más de 15 MB. Sube solo las páginas del resumen')

  const forma = new FormData()
  forma.append('archivo', pdf)
  forma.append('modo', modo)

  return subir<ExtraccionResponse>(`/tarjetas/${tarjetaId}/extraccion`, forma)
}

// --------------------------- 2. explicacion de prioridad de deuda
/**
 * El ranking de deuda contado en español llano.
 *
 * Sin argumentos: el backend recalcula el ranking. Antes se le subía el
 * `DeudaResponse` entero para que lo explicara.
 *
 * La caché de sesión se queda aquí y no en el servidor porque es la única que
 * ahorra la petición completa: la explicación no cambia mientras el ranking sea
 * el mismo, y volver a pedirla cuesta dinero de verdad.
 */
export async function explicarPrioridad(
  huella: string,
): Promise<ExplicacionDeudaResponse> {
  const llave = 'expl_deuda_' + huella

  try {
    const cache = sessionStorage.getItem(llave)
    if (cache) return JSON.parse(cache)
  } catch {
    // Modo privado o storage lleno: se pide de nuevo y ya.
  }

  // Con VITE_MOCK=1 esto lo contesta lib/mock.ts: el cliente HTTP ya desvía.
  const r = await get<ExplicacionDeudaResponse>('/deuda/explicacion')

  try {
    sessionStorage.setItem(llave, JSON.stringify(r))
  } catch { /* no poder cachear no es un error que mostrar */ }

  return r
}

// ------------------------------------ 3. análisis profundo de una compra
/**
 * La simulación, contada: por qué gana la forma de pago que ganó y si la compra
 * en sí es buena idea.
 *
 * Se manda EL MISMO cuerpo que a `api.simular()`, no sus resultados: el
 * servidor rehace la simulación. Subirle los escenarios ya calculados dejaría
 * que el cliente eligiera sobre qué números se redacta, y bastaría con mandar
 * una lista recortada para conseguir la explicación que uno quiera.
 *
 * NO es automático como la explicación de deuda: cuesta dinero y tarda
 * segundos, así que lo dispara un botón. La caché es por huella de la petición
 * —mientras la compra y las tarjetas de la mesa no cambien, el texto tampoco—
 * y es lo que hace que volver a abrir el panel sea gratis.
 */
export async function analizarCompra(
  peticion: SimulacionRequest, huella: string,
): Promise<AnalisisCompraResponse> {
  const llave = 'analisis_compra_' + huella

  try {
    const cache = sessionStorage.getItem(llave)
    if (cache) return JSON.parse(cache)
  } catch {
    // Modo privado o storage lleno: se pide de nuevo y ya.
  }

  const r = await post<AnalisisCompraResponse>('/simulaciones/analisis', peticion)

  try {
    sessionStorage.setItem(llave, JSON.stringify(r))
  } catch { /* no poder cachear no es un error que mostrar */ }

  return r
}