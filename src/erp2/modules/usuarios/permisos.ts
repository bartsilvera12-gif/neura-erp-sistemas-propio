/**
 * Catálogo de PERMISOS (acciones sensibles) de los perfiles. Es el mismo que la base
 * (permisos_catalogo() en db/canonical/55_usuarios_perfiles.sql): si se agrega uno acá,
 * agregarlo también allá.
 *
 * `niveles`: con qué nivel base tiene sentido. Algunas funciones de la base todavía exigen un
 * rol (ej. registrar_compra exige ADMIN): esos permisos solo se pueden dar a perfiles de ese
 * nivel (el editor los deshabilita para los demás).
 */
export type Nivel = "ADMIN" | "SUPERVISOR" | "CAJERO" | "VENDEDOR";

export const NIVELES: { id: Nivel; label: string; detalle: string }[] = [
  { id: "ADMIN", label: "Administrador", detalle: "Puede todo lo que el perfil le permita, en todas las sucursales." },
  { id: "SUPERVISOR", label: "Supervisor", detalle: "Encargado de sucursal: caja, anulaciones y cierres." },
  { id: "CAJERO", label: "Cajero", detalle: "Vende y cobra en la caja; inventario básico." },
  { id: "VENDEDOR", label: "Vendedor", detalle: "Vende, cotiza y atiende clientes." },
];

export const nivelLabel = (n?: string) => NIVELES.find((x) => x.id === n)?.label ?? n ?? "";

export type Permiso =
  | "ver_costos" | "anular_ventas" | "anular_ventas_cerradas" | "notas_credito" | "descuentos_precio" | "vender_credito"
  | "abrir_cerrar_caja" | "movimientos_caja" | "ver_cajas_otras_sucursales" | "pedidos_mesas" | "cocina" | "pedidos_mostrador"
  | "registrar_cobros" | "registrar_transferencias" | "aprobar_transferencias" | "anular_cobros" | "perdonar_mora"
  | "registrar_compras" | "anular_compras" | "registrar_gastos" | "anular_gastos" | "pagar_proveedores"
  | "editar_productos" | "ajustes_inventario" | "registrar_perdidas" | "aprobar_perdidas" | "crear_traslados" | "recibir_traslados" | "fabricar"
  | "ver_cierres_caja" | "ver_reportes_financieros" | "exportar"
  | "administrar_usuarios" | "configuracion" | "administrar_rrhh"
  | "sorteos_vender" | "sorteos_revisar" | "sorteos_administrar"
  | "gimnasio_recepcion" | "gimnasio_forzar_entrada" | "gimnasio_administrar";

export type DefPermiso = {
  id: Permiso;
  label: string;
  descripcion: string;
  /** Niveles base con los que funciona (vacío = cualquiera). */
  niveles?: Nivel[];
  /** Acción delicada: se marca en el editor. */
  sensible?: boolean;
};

export const GRUPOS_PERMISOS: { id: string; label: string; permisos: DefPermiso[] }[] = [
  {
    id: "ventas",
    label: "Ventas y caja",
    permisos: [
      { id: "ver_costos", label: "Ver costos y márgenes", descripcion: "Ve el costo de los productos, la ganancia y los márgenes en productos, ventas, inicio y reportes.", sensible: true },
      { id: "anular_ventas", label: "Anular ventas", descripcion: "Anula una venta del turno abierto: el stock vuelve y el cobro sale del arqueo.", sensible: true },
      { id: "anular_ventas_cerradas", label: "Anular ventas de turnos cerrados", descripcion: "Anula ventas de un turno que ya se cerró (con motivo). El efectivo se devuelve desde una caja abierta.", sensible: true },
      { id: "notas_credito", label: "Hacer y anular notas de crédito", descripcion: "Devuelve productos (vuelven al stock o quedan como pérdida) o hace un descuento sobre una venta ya hecha: baja la deuda, devuelve la plata desde la caja o la deja como saldo a favor del cliente.", sensible: true },
      { id: "descuentos_precio", label: "Dar descuentos y cambiar precios en caja", descripcion: "Cambia el precio de un producto al vender o hace descuentos (por producto o a toda la venta), hasta el tope del perfil." },
      { id: "vender_credito", label: "Vender a crédito", descripcion: "Hace ventas a crédito: el cliente paga después y queda en sus cuentas a cobrar." },
      { id: "abrir_cerrar_caja", label: "Abrir y cerrar caja", descripcion: "Abre un turno de caja con el monto inicial y lo cierra con el arqueo." },
      { id: "movimientos_caja", label: "Retiros e ingresos de efectivo", descripcion: "Registra (y anula) retiros e ingresos de efectivo: depósito al banco, cambio, aporte del dueño…" },
      { id: "ver_cajas_otras_sucursales", label: "Ver cajas de otras sucursales", descripcion: "Ve el estado de las cajas de todas las sucursales, no solo de la suya." },
      { id: "pedidos_mesas", label: "Atender pedidos de mesas", descripcion: "Acepta o rechaza los pedidos que llegan por el QR de las mesas y cobra la cuenta de cada mesa." },
      { id: "cocina", label: "Pantalla de cocina", descripcion: "Ve los pedidos aceptados de las mesas y los marca en preparación y listos." },
      { id: "pedidos_mostrador", label: "Armar pedidos de mostrador", descripcion: "Arma pedidos en Caja › Pedidos y los envía a caja con un número; los edita o anula mientras no se cobran. El nivel Vendedor ve solo los suyos y no los cobra; los demás niveles ven todos y los cobran en Nueva venta." },
    ],
  },
  {
    id: "cobranzas",
    label: "Cobranzas",
    permisos: [
      { id: "registrar_cobros", label: "Registrar cobros", descripcion: "Cobra cuentas de clientes en la caja y usa su saldo a favor." },
      { id: "registrar_transferencias", label: "Cargar transferencias para conciliar", descripcion: "Carga transferencias de clientes para que se aprueben en Conciliación.", niveles: ["ADMIN", "SUPERVISOR", "CAJERO"] },
      { id: "aprobar_transferencias", label: "Aprobar y rechazar transferencias", descripcion: "Aprueba, rechaza o anula transferencias en Conciliación. Al aprobar se descuenta la deuda del cliente.", sensible: true },
      { id: "anular_cobros", label: "Anular cobros", descripcion: "Anula un recibo de cobro: la deuda del cliente vuelve a estar pendiente.", sensible: true },
      // Receta 135: interés por mora (Configuración › Planes de cuotas y mora).
      { id: "perdonar_mora", label: "Perdonar el interés por mora", descripcion: "Al cobrar, deja de cobrar el interés por atraso de las cuotas vencidas (con un motivo, que queda registrado).", sensible: true },
    ],
  },
  {
    id: "compras",
    label: "Compras y gastos",
    permisos: [
      { id: "registrar_compras", label: "Registrar compras", descripcion: "Carga compras y órdenes de compra: la mercadería entra al depósito y queda la deuda con el proveedor.", niveles: ["ADMIN"] },
      { id: "anular_compras", label: "Anular compras", descripcion: "Anula una compra: se revierten el stock y la deuda con el proveedor.", niveles: ["ADMIN"], sensible: true },
      { id: "registrar_gastos", label: "Registrar gastos", descripcion: "Carga gastos operativos (alquiler, servicios, sueldos…) y genera los recurrentes del mes.", niveles: ["ADMIN"] },
      { id: "anular_gastos", label: "Anular gastos", descripcion: "Anula un gasto ya confirmado.", niveles: ["ADMIN"], sensible: true },
      { id: "pagar_proveedores", label: "Pagar a proveedores", descripcion: "Registra y anula pagos a proveedores (cuentas a pagar).", niveles: ["ADMIN"], sensible: true },
    ],
  },
  {
    id: "inventario",
    label: "Inventario",
    permisos: [
      { id: "editar_productos", label: "Crear y editar productos y precios", descripcion: "Crea productos, cambia precios y descuentos de lista e importa productos desde Excel." },
      { id: "ajustes_inventario", label: "Ajustes de inventario", descripcion: "Hace ajustes de stock (conteo físico, inventario inicial, correcciones) y los anula.", niveles: ["ADMIN"] },
      { id: "registrar_perdidas", label: "Cargar pérdidas", descripcion: "Carga pérdidas de mercadería (vencimiento, rotura, faltante…). Quedan pendientes hasta que alguien las apruebe." },
      { id: "aprobar_perdidas", label: "Aprobar ajustes y pérdidas", descripcion: "Aprueba o rechaza ajustes y pérdidas: recién ahí se mueve el stock.", sensible: true },
      { id: "crear_traslados", label: "Crear y anular traslados", descripcion: "Manda mercadería de un depósito a otro (con nota de remisión) y anula traslados en tránsito.", niveles: ["ADMIN"] },
      { id: "recibir_traslados", label: "Recibir traslados", descripcion: "Confirma la recepción de un traslado que llega a su sucursal." },
      { id: "fabricar", label: "Fabricar productos", descripcion: "Fabrica por tanda las preparaciones: descuenta las materias primas de la receta y suma el stock de la preparación. Los niveles Administrador y Supervisor también anulan producciones." },
    ],
  },
  {
    id: "reportes",
    label: "Reportes",
    permisos: [
      { id: "ver_cierres_caja", label: "Ver cierres de caja", descripcion: "Ve el reporte de cierres de caja por día (de su sucursal, o de todas según el alcance)." },
      { id: "ver_reportes_financieros", label: "Ver reportes financieros", descripcion: "Ve ventas, estado de cuenta, proveedores, cuentas a cobrar y a pagar y pérdidas.", sensible: true },
      { id: "exportar", label: "Exportar a Excel y PDF", descripcion: "Descarga listados y reportes en Excel o PDF." },
    ],
  },
  {
    id: "administracion",
    label: "Administración",
    permisos: [
      { id: "administrar_usuarios", label: "Administrar usuarios y perfiles", descripcion: "Crea usuarios, les cambia el perfil, los desactiva y arma los perfiles con sus permisos.", niveles: ["ADMIN"], sensible: true },
      { id: "configuracion", label: "Configuración del sistema", descripcion: "Cambia la configuración: cajas, sucursales y depósitos, bancos, categorías, etapas, colas y demás ajustes.", niveles: ["ADMIN"], sensible: true },
      { id: "administrar_rrhh", label: "Administrar RR HH y salarios", descripcion: "Ve y edita los datos del personal, salarios, ausencias, vacaciones y liquidaciones.", niveles: ["ADMIN"], sensible: true },
    ],
  },
  {
    id: "sorteos",
    label: "Sorteos",
    permisos: [
      { id: "sorteos_vender", label: "Vender boletas de sorteos", descripcion: "Ve los sorteos y sus compras y registra ventas manuales con el precio o el combo del sorteo." },
      { id: "sorteos_revisar", label: "Revisar pagos de sorteos", descripcion: "Confirma o rechaza los pagos por transferencia y recibe las rendiciones de los vendedores.", sensible: true },
      { id: "sorteos_administrar", label: "Administrar sorteos, premios y vendedores", descripcion: "Crea y cierra sorteos, carga premios y ganadores, anula compras y maneja los vendedores.", niveles: ["ADMIN"], sensible: true },
    ],
  },
  {
    // Receta 150
    id: "gimnasio",
    label: "Asistencia",
    permisos: [
      { id: "gimnasio_recepcion", label: "Recepción de asistencia", descripcion: "Ve las clases del día, anota alumnos, crea turnos y marca llegadas, asistencias y faltas." },
      { id: "gimnasio_forzar_entrada", label: "Dejar entrar con deuda vencida", descripcion: "Marca la entrada de un alumno que debe (con un motivo, que queda registrado).", sensible: true },
      { id: "gimnasio_administrar", label: "Administrar clases, precios y comisiones", descripcion: "Crea y cambia clases y horarios, el precio de la clase suelta, el bloqueo por deuda y la comisión de los profesores.", niveles: ["ADMIN"], sensible: true },
    ],
  },
];

export const PERMISOS: DefPermiso[] = GRUPOS_PERMISOS.flatMap((g) => g.permisos);
export const TODOS_LOS_PERMISOS: Permiso[] = PERMISOS.map((p) => p.id);

/** Permisos que solo tienen sentido con una función de la empresa prendida (receta 75). */
export const FUNCION_DE_PERMISO: Partial<Record<Permiso, import("@/erp2/modules/configuracion/funciones").FuncionId>> = {
  pedidos_mesas: "mesas",
  cocina: "cocina",
  pedidos_mostrador: "pedidos",
  fabricar: "recetas",
  gimnasio_recepcion: "gimnasio",
  gimnasio_forzar_entrada: "gimnasio",
  gimnasio_administrar: "gimnasio",
};
export const permisoDef = (id: string) => PERMISOS.find((p) => p.id === id);

/** ¿Este permiso funciona con este nivel base? */
export function permisoAplica(p: DefPermiso, nivel: string): boolean {
  return !p.niveles?.length || p.niveles.includes(nivel as Nivel);
}

/** Perfil efectivo de la sesión (lo que devuelve /api/me y lleva el ctx de withTenant). */
export type PerfilSesion = {
  id: string | null;
  nombre: string | null;
  codigo: string | null;
  /** Administrador: todas las pantallas y permisos (también los que se agreguen después). */
  todo: boolean;
  alcance: "propia" | "todas";
  tope_descuento_pct: number | null;
  pantallas: string[];
  permisos: string[];
};
