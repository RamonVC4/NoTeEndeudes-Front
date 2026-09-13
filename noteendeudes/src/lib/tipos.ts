/**
 * CONTRATO DE TIPOS — espejo de app/domain/tipos.py y app/schemas/
 *
 * Copia este archivo al frontend. Si cambias uno, cambia el otro.
 *
 * Verificado contra el OpenAPI real del servidor con:
 *     python -m scripts.verificar_contrato
 *
 * TRES REGLAS QUE VALEN PARA TODO EL ARCHIVO:
 *
 *   1. Los `id` son `string`, siempre. `movimientos.id` es BIGINT UNSIGNED en
 *      la base y en JavaScript los enteros dejan de ser exactos pasados los
 *      2^53. No hagas parseInt.
 *
 *   2. El dinero es `number` con 2 decimales. Las tasas son FRACCION (0.38 =
 *      38%) y las utilizaciones son PORCENTAJE (85.0 = 85%). Están así en toda
 *      la API; mezclarlas es el error más fácil de cometer aquí.
 *
 *   3. Las fechas son `"YYYY-MM-DD"`. Los instantes son ISO-8601 con Z.
 */

export const BASE_URL = "/api/v1";

// =====================================================================
// ENUMS
// =====================================================================

export type Frecuencia = "semanal" | "catorcenal" | "quincenal" | "mensual";
export type TipoTarjeta = "credito" | "debito";
export type TipoMovimiento = "gasto" | "pago" | "ingreso";
export type Componente = "liquidez" | "deuda" | "utilizacion" | "flujo";
export type AjusteMesCorto = "ultimo_dia" | "mes_siguiente";

/**
 * TRES medios, no dos. `efectivo` era irrepresentable en la versión anterior:
 * el medio se infería de `tarjeta_id === null`, que significaba "efectivo O
 * débito" — dos cosas distintas colapsadas en una.
 */
export type MedioPago = "efectivo" | "debito" | "credito";

/** Solo efectivo y débito salen del bolsillo; nada se paga con la misma tarjeta. */
export type MedioSalida = "efectivo" | "debito";

export type Modalidad =
  | "contado" | "credito"
  | "3_msi" | "6_msi" | "9_msi" | "12_msi" | "15_msi" | "18_msi";

export const PLAZOS_COMUNES = [3, 6, 9, 12, 15, 18];

/**
 * Lo emite el MOTOR, no el modelo de lenguaje. Gemini lo redacta; la decisión
 * de si la compra es sana sale de umbrales auditables.
 */
export type Veredicto = "conviene" | "conviene_con_cuidado" | "no_conviene";

/**
 * Las categorías NO se declaran aquí: son un catálogo en la base y se piden con
 * GET /categorias. Antes vivían duplicadas en tipos.py y tipos.ts, no las
 * validaba nadie, y las dos tablas que las usaban ya habían divergido.
 */
export type ClaveCategoria = string;

// =====================================================================
// SOBRES
// =====================================================================

export interface MetaPagina {
  hay_mas: boolean;
  /** Opaco. Devuélvelo tal cual como ?cursor=. No lo interpretes. */
  siguiente_cursor: string | null;
  /** null en las colecciones que crecen: contarlas cuesta lo mismo que leerlas. */
  total: number | null;
}

/** Toda colección. Los recursos sueltos van planos, sin sobre. */
export interface Coleccion<T> {
  data: T[];
  meta: MetaPagina;
}

export interface ApiError {
  error: {
    codigo:
      | "error_dominio"
      | "no_autenticado"
      | "credenciales_invalidas"
      | "no_encontrado"
      | "metodo_no_permitido"
      | "conflicto"
      | "validacion"
      | "regla_de_negocio"
      | "error_persistencia"
      | "error_interno"
      | "error_http";
    mensaje: string;
    detalle: Record<string, unknown> & {
      /** Presente cuando codigo === "validacion". */
      campos?: { campo: string; error: string }[];
      /** Presente cuando una categoría no existe. */
      validas?: string[];
      /** Presente en un 409 por bloqueo optimista. */
      version_actual?: number;
    };
  };
}

// =====================================================================
// SESIÓN Y PERFIL
// =====================================================================

export interface TokenResponse {
  token: string;
  usuario_id: string;
  nombre: string;
}

export interface UsuarioResumen {
  id: string;
  nombre: string;
  email: string;
  es_demo: boolean;
  /**
   * false -> pinta el wizard, NO el score. Un usuario sin datos saca 70 en
   * amarillo, que es falsamente tranquilizador: sin ingresos ni gastos, tres de
   * los cuatro componentes salen perfectos.
   */
  onboarding_completo: boolean;
  saldo_disponible: number;
  creado_en: string;
  version: number;
}

export interface CategoriaResumen {
  id: string;
  /** Lo que mandas en los POST: "comida", minúscula y sin acentos. */
  clave: string;
  /** Lo que muestras: "Comida". */
  nombre: string;
}

export interface LiquidezUpdate {
  saldo: number;
  motivo: string;
  version?: number;
}

// =====================================================================
// INGRESOS
// =====================================================================

/**
 * DOS FAMILIAS DE FRECUENCIA, y el formulario tiene que ramificar:
 *
 *   semanal, catorcenal  -> fecha_ancla obligatoria, dia_pago_2 PROHIBIDO
 *   quincenal            -> dia_pago y dia_pago_2, distintos
 *   mensual              -> dia_pago, dia_pago_2 PROHIBIDO
 *
 * Catorcenal son 26 pagos al año: hay meses con dos y meses con tres, así que
 * no es expresable como días del mes.
 */
export interface IngresoCreate {
  concepto: string;
  monto: number;
  frecuencia: Frecuencia;
  dia_pago?: number | null;
  dia_pago_2?: number | null;
  fecha_ancla?: string | null;
  ajuste_mes_corto?: AjusteMesCorto;
}

export type IngresoUpdate = Partial<Omit<IngresoCreate, "frecuencia">> & {
  activo?: boolean;
};

export interface IngresoResumen {
  id: string;
  concepto: string;
  monto: number;
  frecuencia: Frecuencia;
  dia_pago: number | null;
  dia_pago_2: number | null;
  fecha_ancla: string | null;
  ajuste_mes_corto: AjusteMesCorto;
  activo: boolean;
  /** Derivados: no existen como columnas. */
  monto_mensual: number;
  ultimo_cobro: string | null;
  proximo_cobro: string | null;
}

// =====================================================================
// GASTOS RECURRENTES
// =====================================================================

export interface RecurrenteCreate {
  concepto: string;
  monto: number;
  categoria: ClaveCategoria;
  dia_del_mes: number;
  /**
   * OBLIGATORIA. Define la FASE del ciclo: la luz bimestral de quien empezó en
   * enero cae en meses nones y la de quien empezó en febrero, en pares.
   */
  fecha_inicio: string;
  fecha_fin?: string | null;
  /** 1 mensual · 2 bimestral · 3 trimestral · 6 semestral · 12 anual. */
  frecuencia_meses?: number;
  /**
   * Luz, agua, gas. No guarda un rango: cambia el comportamiento de la app —
   * al confirmar, `monto` pasa a ser obligatorio.
   */
  es_variable?: boolean;
  ajuste_mes_corto?: AjusteMesCorto;
}

export type RecurrenteUpdate = Partial<RecurrenteCreate> & { activo?: boolean };

export interface RecurrenteResumen {
  id: string;
  concepto: string;
  monto: number;
  categoria: ClaveCategoria;
  categoria_nombre: string;
  dia_del_mes: number;
  frecuencia_meses: number;
  es_variable: boolean;
  ajuste_mes_corto: AjusteMesCorto;
  fecha_inicio: string;
  fecha_fin: string | null;
  activo: boolean;
  /**
   * AMORTIZADO: una luz de $900 bimestral pesa $450. Es la cifra para "cuánto
   * se me va en obligaciones" y la INCORRECTA para "me alcanza este mes" —
   * para eso está Pendiente.monto_esperado, que va completo.
   */
  peso_mensual: number;
}

export interface RecurrenteHistorial {
  recurrente_id: string;
  concepto: string;
  es_variable: boolean;
  monto_declarado: number;
  pagos_considerados: number;
  monto_min: number | null;
  monto_max: number | null;
  monto_promedio: number | null;
  ultimo_pago: string | null;
  /** El MÁXIMO reciente, no el promedio: quedarse corto es el error caro. */
  monto_para_proyectar: number;
}

// =====================================================================
// CONFIRMACIONES Y PENDIENTES
// =====================================================================

export interface ConfirmacionCreate {
  fecha?: string;
  /** Obligatorio si el recurrente es es_variable. Sin él, 422. */
  monto?: number;
  descripcion?: string;
  medio?: MedioSalida;
}

export interface Confirmacion {
  ok: boolean;
  score_actualizado: number | null;
}

/** NO es una fila de ninguna tabla: se deriva al vuelo. */
export interface Pendiente {
  tipo: "ingreso" | "recurrente";
  origen_id: string;
  concepto: string;
  fecha_esperada: string;
  /** COMPLETO, no amortizado: la pregunta es "me alcanza este mes". */
  monto_esperado: number;
  /** true -> es un variable; pide el monto real antes de confirmar. */
  monto_incierto: boolean;
  categoria: ClaveCategoria | null;
  dias_restantes: number;
}

export interface PendientesResponse {
  ingresos: Pendiente[];
  gastos: Pendiente[];
  total_por_cobrar: number;
  total_por_pagar: number;
}

// =====================================================================
// TARJETAS, MSI Y CORTES
// =====================================================================

export interface TarjetaCreate {
  banco: string;
  nombre: string;
  tipo: TipoTarjeta;
}

/** PATCH parcial. Manda `version` o pisarás cambios ajenos (409). */
export interface TarjetaUpdate {
  banco?: string;
  nombre?: string;
  limite?: number;
  saldo?: number;
  /** FRACCIÓN: 38% se manda como 0.38. */
  tasa_anual?: number;
  pago_minimo?: number;
  dia_corte?: number;
  dia_limite_pago?: number;
  monto_minimo_msi?: number;
  activa?: boolean;
  version?: number;
}

export interface MSIResumen {
  id: string;
  tarjeta_id: string;
  descripcion: string | null;
  /** La verdad de la deuda. `monto_mensual` es informativo. */
  monto_total: number | null;
  monto_mensual: number;
  meses_totales: number;
  /** DERIVADO de la fecha, no un contador guardado. */
  meses_restantes: number;
  saldo_pendiente: number;
  fecha_inicio: string;
  /** null -> capturado de un estado de cuenta, sin compra en la app. */
  movimiento_id: string | null;
}

export interface TarjetaResumen {
  id: string;
  banco: string;
  nombre: string;
  tipo: TipoTarjeta;
  activa: boolean;
  limite: number | null;
  saldo: number | null;
  /** Derivado (limite - saldo). Nunca se guarda. */
  disponible: number | null;
  tasa_anual: number | null;
  pago_minimo: number | null;
  dia_corte: number | null;
  dia_limite_pago: number | null;
  monto_minimo_msi: number | null;
  msi: MSIResumen[];
  /** true -> esta tarjeta NO entra al score ni al simulador. */
  requiere_terminos: boolean;
  version: number;
}

/** Solo para planes capturados de un estado de cuenta. */
export interface MSICreate {
  tarjeta_id: string;
  monto_mensual: number;
  meses_totales: number;
  meses_restantes: number;
  fecha_inicio: string;
  descripcion?: string;
  monto_total?: number;
}

export interface PeriodoCreate {
  fecha_inicio: string;
  fecha_corte: string;
  fecha_limite_pago: string;
}

export interface PeriodoResumen {
  id: string;
  tarjeta_id: string;
  fecha_inicio: string;
  fecha_corte: string;
  fecha_limite_pago: string;
  /** Lo que debías el día del corte. NO es el saldo de hoy. */
  saldo_al_corte: number;
  pago_minimo: number;
  /** El número que importa: pagando esto, la tasa no corre. */
  pago_no_intereses: number;
  msi_del_periodo: number;
  pagado: number;
  intereses_generados: number;
  cerrado: boolean;
  falta_para_no_intereses: number;
  falta_para_no_mora: number;
}

export interface PagoPendiente {
  tarjeta_id: string;
  banco: string;
  tarjeta: string;
  fecha_corte: string;
  fecha_limite_pago: string;
  dias_restantes: number;
  saldo_al_corte: number;
  pago_minimo: number;
  pago_no_intereses: number;
  pagado: number;
  falta_para_no_intereses: number;
  falta_para_no_mora: number;
}

// =====================================================================
// MOVIMIENTOS
// =====================================================================

/** `meses` los define el COMERCIO, no la tarjeta. */
export interface MSIEnCompra {
  meses: number;
  descripcion?: string;
  monto_mensual?: number;
}

/**
 * COMBINACIONES VÁLIDAS (cualquier otra da 422):
 *
 *   gasto   + efectivo/debito + SIN tarjeta   -> baja la liquidez
 *   gasto   + credito         + CON tarjeta   -> sube el saldo; liquidez intacta
 *   pago    + efectivo/debito + CON tarjeta   -> baja las dos
 *   ingreso + efectivo/debito + SIN tarjeta   -> sube la liquidez
 */
export interface MovimientoCreate {
  tipo: TipoMovimiento;
  medio: MedioPago;
  monto: number;
  fecha: string;
  /** Clave del catálogo. Obligatoria en los gastos. */
  categoria?: string | null;
  descripcion?: string | null;
  tarjeta_id?: string | null;
  ingreso_id?: string | null;
  recurrente_id?: string | null;
  /** Solo con medio "credito". Sube el saldo por el TOTAL, no por la mensualidad. */
  msi?: MSIEnCompra | null;
}

export interface MovimientoResumen {
  id: string;
  tipo: TipoMovimiento;
  medio: MedioPago;
  monto: number;
  fecha: string;
  categoria: ClaveCategoria | null;
  categoria_nombre: string | null;
  descripcion: string | null;
  tarjeta_id: string | null;
  tarjeta_nombre: string | null;
  periodo_id: string | null;
  ingreso_id: string | null;
  recurrente_id: string | null;
}

/** El micro-momento. Muestra el COMPONENTE, no el score global. */
export interface Impacto {
  score_antes: number;
  score_despues: number;
  componente_afectado: Componente;
  componente_antes: number;
  componente_despues: number;
}

export interface MovimientoResponse {
  movimiento: MovimientoResumen;
  impacto: Impacto;
  /**
   * true (con HTTP 200 en vez de 201) -> la Idempotency-Key ya se había usado.
   * El movimiento ya existía y el saldo NO se movió otra vez: no descuentes
   * de nuevo en tu UI optimista.
   */
  repetido: boolean;
}

export interface Borrado {
  motivo: string;
}

// =====================================================================
// ONBOARDING
// =====================================================================

export interface TerminosOnboarding {
  limite: number;
  saldo: number;
  tasa_anual: number;
  pago_minimo: number;
  dia_corte: number;
  dia_limite_pago: number;
  monto_minimo_msi?: number;
}

export interface TarjetaOnboarding {
  banco: string;
  nombre: string;
  tipo: TipoTarjeta;
  /** Obligatorio en crédito, PROHIBIDO en débito. */
  terminos?: TerminosOnboarding | null;
}

export interface OnboardingRequest {
  liquidez: number;
  ingresos?: IngresoCreate[];
  tarjetas?: TarjetaOnboarding[];
  gastos_fijos?: RecurrenteCreate[];
}

export interface OnboardingResponse {
  ok: boolean;
  liquidez: number;
  ingresos_creados: number;
  tarjetas_creadas: number;
  gastos_fijos_creados: number;
  score_actualizado: number;
}

// =====================================================================
// ESTADO — el contrato CONGELADO del motor
// =====================================================================

/**
 * Ojo con el vocabulario: aquí es `tasa` / `corte` / `limite_pago`, mientras
 * que TarjetaResumen usa `tasa_anual` / `dia_corte` / `dia_limite_pago`. No es
 * un descuido: este objeto es el que consume el motor y su forma está
 * congelada.
 */
export interface TarjetaEstado {
  id: string;
  nombre: string;
  limite: number;
  saldo: number;
  tasa: number;
  pago_minimo: number;
  corte: number;
  limite_pago: number;
  monto_minimo_msi: number;
  msi: { monto_mensual: number; meses_restantes: number; descripcion: string | null }[];
  disponible: number;
}

export interface Estado {
  liquidez: number;
  ingreso: { mensual: number };
  ingresos_programados: { dia: number; monto: number; concepto: string }[];
  gastos: { fijos: number; variables_prom: number };
  compromisos: { dia: number; monto: number; concepto: string }[];
  /** Solo crédito, activas y con términos completos. */
  tarjetas: TarjetaEstado[];
}

// =====================================================================
// SCORE
// =====================================================================

export type Banda = "Saludable" | "Estable" | "En riesgo" | "Critico";
export type ColorBanda = "verde" | "amarillo" | "naranja" | "rojo";

export interface ScoreResponse {
  score: number;
  score_exacto: number;
  banda: string;
  color: string;
  componentes: Record<Componente, number>;
  pesos: Record<Componente, number>;
  gasto_mensual_total: number;
  obligaciones_mensuales: number;
  intereses_mensuales: number;
  flujo_30d: {
    /** 30 valores. */
    serie: number[];
    minimo: number;
    dia_minimo: number;
  };
}

// =====================================================================
// SIMULADOR — solo lectura
// =====================================================================

/**
 * Una tarjeta puesta sobre la mesa, con los meses que ofrece la tienda CON ESA
 * tarjeta. La misma tienda da 18 con una y ninguno con otra.
 */
export interface OpcionTarjeta {
  tarjeta_id: string;
  /** Solo 3/6/9/12/15/18. Otro valor es 422. Vacío -> solo revolvente. */
  plazos: number[];
}

export interface SimulacionRequest {
  monto: number;
  descripcion?: string | null;
  /**
   * LEGADO: una sola lista para TODAS las tarjetas. Se ignora si viene
   * `tarjetas`.
   */
  plazos?: number[];
  /**
   * La forma buena de pedirlo. Cuando viene, manda sobre `plazos` y además
   * define QUÉ tarjetas entran: las que no pusiste no se evalúan.
   */
  tarjetas?: OpcionTarjeta[] | null;
  /** Sacar el efectivo de la comparación. Se ignora sin `tarjetas`. */
  incluir_contado?: boolean;
}

export interface Escenario {
  modalidad: Modalidad | null;
  tarjeta: string | null;
  tarjeta_id: string | null;
  disponible: number;
  /**
   * OJO: significa dos cosas. En contado es el EFECTIVO que te queda; en
   * tarjeta es la LÍNEA DE CRÉDITO libre. No los compares entre sí.
   */
  holgura_despues: number | null;
  pago_mensual: number;
  viable: boolean;
  /** Presente cuando viable === false. PÍNTALO: la razón es información útil. */
  motivo: string | null;
  score_despues: number | null;
  delta: number | null;
  /** Monto pelado en contado y MSI; monto + intereses en revolvente. */
  costo_total: number | null;
  /** El mejor escenario DENTRO de su tarjeta. Lo marca el motor. */
  mejor_de_tarjeta: boolean;
}

/** El tamaño de la compra medido contra la vida del usuario. Las calcula el motor. */
export interface MetricasCompra {
  monto_vs_liquidez_pct: number;
  monto_vs_ingreso_mensual_pct: number;
  /** Meses de gasto que cubre la liquidez. */
  colchon_meses_antes: number;
  colchon_meses_despues: number;
  /** PORCENTAJE: 56.2 = 56%. */
  utilizacion_antes: number;
  utilizacion_despues: number;
}

export interface SimulacionResponse {
  monto: number;
  /** Unión de todos los plazos puestos sobre la mesa. */
  plazos_ofrecidos: number[];
  score_actual: number;
  recomendado: Escenario | null;
  /** Incluye los inviables, marcados. No los filtres. */
  escenarios: Escenario[];
  /**
   * Del MOTOR, no de la IA: "la mejor forma de pagarlo sigue siendo mala idea".
   * Píntalo siempre — no espera a Gemini y aparece aunque la IA esté caída.
   */
  veredicto: Veredicto;
  razones_veredicto: string[];
  metricas: MetricasCompra | null;
}

// =====================================================================
// DEUDA
// =====================================================================

export interface DeudaRanking {
  /** Úsalo para pagar. Nunca cruces por nombre: dos tarjetas pueden repetirlo. */
  tarjeta_id: string;
  tarjeta: string;
  saldo: number;
  /** PORCENTAJE: 85.0 = 85%. */
  utilizacion: number;
  /** FRACCIÓN: 0.68 = 68%. */
  tasa: number;
  costo_intereses_mes: number;
  prioridad: number;
  razones: string[];
}

export interface DeudaResponse {
  ranking: DeudaRanking[];
  intereses_totales_mes: number;
}

export interface PagoRequest {
  tarjeta_id: string;
  monto: number;
  fecha?: string;
  medio?: MedioSalida;
}

export interface PagoResponse {
  ok: boolean;
  score_antes: number;
  score_despues: number;
  /** El beneficio grande. Muéstralo siempre: se entiende sin explicación. */
  ahorro_intereses_mensual: number;
  nuevo_saldo_tarjeta: number;
}


// =====================================================================
// IA — lectura de estados de cuenta y explicaciones
// =====================================================================
// Las llamadas a Gemini las hace el BACKEND. La API key nunca sale del
// servidor: cuando vivía en el frontend, Vite la metía en el bundle y era
// públicamente extraíble.
//
// Nada de esto se persiste. La extracción PRELLENA el formulario de términos
// y la explicación es texto sobre un ranking que el motor ya calculó.

/** Cómo paga la persona esa tarjeta. Decide cuál de los dos pagos se prellena. */
export type ModoPago = "minimo" | "total";

export type Confianza = "alta" | "media" | "baja";

/**
 * Un plan a meses tal como lo imprime el estado de cuenta.
 *
 * NO es un MSICreate: le faltan `meses_totales` y `fecha_inicio`, que el
 * documento no imprime nunca. Inventarlos sería peor que pedirlos — en el
 * backend `meses_restantes` se DERIVA de `fecha_inicio`, así que una fecha
 * inventada mueve la deuda. El formulario los deja para el usuario.
 */
export interface PlanLeido {
  descripcion: string | null;
  monto_mensual: number;
  meses_restantes: number;
}

/**
 * Los dos pagos que imprime el estado de cuenta. Son números distintos y la
 * tarjeta guarda uno solo; viajan los dos para que cambiar de modo en el
 * formulario no obligue a releer el PDF.
 */
export interface PagosLeidos {
  minimo: number | null;
  sin_intereses: number | null;
}

/**
 * Respuesta de `POST /tarjetas/{id}/extraccion` (multipart: `archivo` + `modo`).
 *
 * `valores` trae campos del CONTRATO (tasa en fracción, saldo ya derivado);
 * `campos_ia` trae nombres de campos del FORMULARIO, que no son los mismos:
 * allí la tasa se captura en porcentaje y el saldo sale del disponible.
 */
export interface ExtraccionResponse {
  valores: Partial<TerminosOnboarding>;
  banco: string | null;
  /** Para resaltar en el formulario lo que salió del PDF. */
  campos_ia: string[];
  /** Ya redactados: píntalos tal cual arriba del formulario. */
  avisos: string[];
  confianza: Confianza;
  pagos: PagosLeidos;
  /** Crédito disponible impreso. De aquí sale el saldo, no al revés. */
  disponible: number | null;
  planes: PlanLeido[];
}

/**
 * Respuesta de `GET /deuda/explicacion`. Sin cuerpo en la petición: el ranking
 * se recalcula en el servidor.
 *
 * Es adorno, no dato. Si responde 503, pinta el ranking con sus razones
 * calculadas y ya.
 */
export interface ExplicacionDeudaResponse {
  titular: string;
  explicacion: string;
  siguiente_paso: string;
  comparativa: string | null;
  confianza: Confianza;
}

/**
 * Respuesta de `POST /simulaciones/analisis`. El cuerpo es el MISMO
 * `SimulacionRequest` del simulador: el servidor rehace la simulación en vez de
 * recibir los escenarios, para que el cliente no elija sobre qué números se
 * redacta.
 *
 * Mezcla deliberada de dos fuentes: `veredicto` y `razones_veredicto` son del
 * MOTOR; el resto es prosa de Gemini construida sobre ellos. La IA nunca decide
 * si la compra conviene, la cuenta.
 *
 * Es adorno, no dato. Si responde 503, la pantalla se pinta entera con la
 * simulación y su veredicto.
 */
export interface AnalisisCompraResponse {
  titular: string;
  explicacion: string;
  /** De 2 a 4 contrastes contra las otras opciones, cada uno una oración. */
  comparativas: string[];
  /** Pregunta que invita a pensar. null cuando el veredicto es "conviene". */
  reflexion: string | null;
  riesgos: string[];
  confianza: Confianza;
  /** Del motor, no del modelo. */
  veredicto: Veredicto;
  razones_veredicto: string[];
  /** Clave del catálogo. Prellena el formulario al registrar la compra. */
  categoria: ClaveCategoria;
  categoria_nombre: string;
}