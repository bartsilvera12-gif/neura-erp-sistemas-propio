/**
 * Manual de usuario: una guía por tarea, escrita para ESTE ERP. Cada guía declara la pantalla que
 * explica (`ruta`), así se muestra solo si esa pantalla está en el menú de la persona.
 *
 * Los pasos con `marca` llevan una flecha sobre la captura: `marca` es el texto del botón o campo en
 * esa captura y su posición sale de marcas.json (se mide sobre la pantalla real al sacar la captura).
 * Las capturas están en public/guias/neura, con los datos reales difuminados.
 */
/** t: la frase grande, una sola acción. d: aclaración, en letra chica. */
export type Paso = { t: string; d?: string; marca?: string };
export type Bloque = { img?: string; alt?: string; pasos?: Paso[]; texto?: string; consejo?: string; ojo?: string; rubro?: "comercio" | "gastronomia" };
export type Guia = {
  id: string;
  grupo: string;
  titulo: string;
  resumen: string;
  /** Pantalla que explica. Sin ruta: se muestra siempre. */
  ruta?: string;
  rubro?: string;
  bloques: Bloque[];
};

/** Cómo se llega a la pantalla de cada guía: el renglón del menú y la tarjeta de su portada. */
export const LLEGAR: Record<string, [string, string?]> = {
  cliente: ["Comercial", "Clientes"],
  crm: ["Comercial", "CRM Funnel"],
  agenda: ["Comercial", "Agenda"],
  propuestas: ["Comercial", "Propuestas"],
  "proyecto-nuevo": ["Comercial", "Proyectos"],
  "proyecto-mover": ["Comercial", "Proyectos"],
  "chat-responder": ["Omnicanal", "Conversaciones"],
  "chat-transferir": ["Omnicanal", "Conversaciones"],
  "chat-finalizar": ["Omnicanal", "Conversaciones"],
  "chat-ticket": ["Omnicanal", "Conversaciones"],
  tickets: ["Soporte", "Tickets"],
  cobranzas: ["Finanzas", "Cobranzas"],
  reportes: ["Finanzas", "Reportes"],
  "usuario-nuevo": ["RRHH", "Usuarios y accesos"],
  guardias: ["RRHH", "Guardias"],
};
/** La captura de la portada que abre cada renglón del menú. */
export const PANELES: Record<string, string> = {
  Comercial: "panel-comercial",
  Finanzas: "panel-finanzas",
  Omnicanal: "panel-omnicanal",
  Soporte: "panel-soporte",
  RRHH: "panel-rrhh",
};
/** La captura donde se ve el renglón en el menú, si no es la de Inicio. */
export const MENUS: Record<string, string> = {};

export const GUIAS: Guia[] = [
  // ── Primeros pasos ────────────────────────────────────────────────────────────────────
  {
    id: "moverse", grupo: "Primeros pasos", titulo: "Cómo moverte por el sistema",
    resumen: "El menú, las portadas, el buscador y cómo volver.",
    bloques: [
      { img: "inicio", alt: "Pantalla de inicio con el menú a la izquierda", pasos: [
        { t: "El menú de la izquierda tiene un renglón por área.", d: "Comercial, Finanzas, Omnicanal, Soporte… Ves solo las áreas que tenés habilitadas.", marca: "Comercial" },
      ] },
      { img: "panel-comercial", alt: "Portada de Comercial con sus tarjetas", pasos: [
        { t: "Al tocar un área se abre su portada, con una tarjeta por pantalla.", d: "Tocá la tarjeta de la pantalla a la que querés entrar.", marca: "Clientes" },
      ] },
      { img: "clientes", alt: "Pantalla de Clientes", pasos: [
        { t: "Para volver a la portada, usá el link de arriba a la izquierda.", d: "Dice el área y la pantalla donde estás: «← Comercial / Clientes»." },
      ] },
      { img: "inicio", pasos: [
        { t: "Si no encontrás una pantalla, escribí su nombre en el buscador del menú.", d: "Te muestra la pantalla directamente, sin pasar por la portada.", marca: "Buscar en el menú…" },
      ], consejo: "Arriba a la derecha están la Ayuda en línea, las Guardias de la semana y la campanita con tus avisos." },
    ],
  },
  {
    id: "inicio", grupo: "Primeros pasos", ruta: "/", titulo: "Entender la pantalla de Inicio",
    resumen: "Los números del período y cómo cambiarlo.",
    bloques: [
      { img: "inicio", alt: "Pantalla de inicio", pasos: [
        { t: "Inicio muestra cómo viene la empresa en el período elegido.", d: "Leads nuevos, ventas facturadas, clientes ganados y suscripciones nuevas." },
        { t: "Arriba a la derecha elegís el período: Hoy, 7 días, 30 días, Mes actual o Año." },
        { t: "Con las pestañas cambiás de vista: Comercial, Financiero o Deuda de suscripciones.", d: "Cada persona ve las vistas que tiene habilitadas." },
      ] },
    ],
  },

  // ── Clientes y ventas ─────────────────────────────────────────────────────────────────
  {
    id: "cliente", grupo: "Clientes y ventas", ruta: "/clientes", titulo: "Cargar un cliente",
    resumen: "Sumar una empresa o una persona a la base de clientes.",
    bloques: [
      { img: "clientes", alt: "Lista de clientes", pasos: [
        { t: "Tocá Nuevo cliente.", marca: "Nuevo cliente" },
      ] },
      { img: "cliente-nuevo", alt: "Formulario para crear un cliente", pasos: [
        { t: "Elegí si es una Empresa o una Persona.", marca: "Empresa" },
        { t: "Escribí el nombre.", marca: "NOMBRE DE EMPRESA *" },
        { t: "Elegí el tipo de servicio.", marca: "TIPO DE SERVICIO *" },
        { t: "Cargá la persona de contacto y su teléfono.", marca: "PERSONA DE CONTACTO *" },
        { t: "Completá lo demás si lo tenés y tocá Guardar cliente, al final del formulario.", d: "RUC, razón social, email, dirección, vendedor responsable y plan." },
      ], ojo: "Los campos con * son obligatorios: sin ellos no deja guardar." },
    ],
  },
  {
    id: "crm", grupo: "Clientes y ventas", ruta: "/crm", titulo: "Seguir a los posibles clientes",
    resumen: "Cargar un prospecto y moverlo por las etapas hasta que sea cliente.",
    bloques: [
      { img: "crm", alt: "Tablero del CRM con una columna por etapa", pasos: [
        { t: "Cada columna es una etapa y cada tarjeta es un prospecto.", d: "Lead, Contactado, Charlando, Negociación, Ganado.", marca: "Kanban" },
        { t: "Para cambiarlo de etapa, arrastrá la tarjeta a otra columna.", d: "También podés usar «Mover a etapa» en la misma tarjeta." },
        { t: "Para cargar uno nuevo, tocá Nuevo prospecto.", marca: "Nuevo prospecto" },
      ] },
      { img: "crm-nuevo", alt: "Formulario para crear un prospecto", pasos: [
        { t: "Escribí la empresa y la persona de contacto.", marca: "EMPRESA *" },
        { t: "Cargá el teléfono.", marca: "TELÉFONO" },
        { t: "Elegí en qué etapa arranca.", marca: "ETAPA INICIAL" },
        { t: "Anotá la próxima acción con su fecha y tocá Guardar prospecto, al final." },
      ], consejo: "Cuando el prospecto cierra, tocá «Transformar a cliente» en su tarjeta: crea el cliente con esos datos y lo marca como Ganado." },
    ],
  },
  {
    id: "agenda", grupo: "Clientes y ventas", ruta: "/dashboard/agenda", titulo: "Agendar una cita",
    resumen: "Una reunión, una demo o una capacitación, con día y hora.",
    bloques: [
      { img: "agenda", alt: "Agenda de la semana", pasos: [
        { t: "Tocá Nueva cita.", marca: "Nueva cita" },
      ] },
      { img: "agenda-nueva", alt: "Ventana para crear una cita", pasos: [
        { t: "Poné un título.", d: "Por ejemplo: Demo con cliente.", marca: "Título *" },
        { t: "Elegí quiénes participan.", marca: "Responsables *" },
        { t: "Elegí la fecha y la hora de inicio.", d: "Con los botones 15m, 30m, 1h marcás cuánto dura.", marca: "Fecha *" },
        { t: "Si es con un cliente, elegilo.", d: "Si todavía no es cliente, usá «Nuevo contacto».", marca: "Cliente existente" },
        { t: "Tocá Guardar.", marca: "Guardar" },
      ] },
    ],
  },

  {
    id: "propuestas", grupo: "Clientes y ventas", ruta: "/propuestas", titulo: "Armar una propuesta comercial",
    resumen: "Elegir los servicios, poner el cliente y los precios, y bajar el PDF.",
    bloques: [
      { img: "propuestas", alt: "Pantalla de Propuestas con el catálogo de piezas", pasos: [
        { t: "A la izquierda están las piezas: los servicios que se pueden ofrecer.", d: "Están agrupadas por sección. Tocá una sección para abrirla." },
        { t: "Si no encontrás una, buscala por lo que hace.", d: "Por ejemplo: stock, WhatsApp, reparto.", marca: "Buscar pieza: stock, WhatsApp, reparto…" },
        { t: "Tocá el + de una pieza para sumarla a la propuesta.", d: "También podés arrastrarla hasta la hoja.", marca: "Agregar Sistema CRM omnicanal a la propuesta" },
        { t: "Elegí el cliente, o escribí su nombre si todavía no está cargado.", marca: "O escribí el nombre" },
        { t: "Poné el título de la propuesta y una línea que la resuma.", marca: "Título de la propuesta" },
      ], consejo: "En la hoja, las piezas se reordenan arrastrándolas y se quitan con la ✕ que aparece al pasar el cursor." },
      { img: "propuestas-armada", alt: "Una propuesta con sus precios y clientes bandera", pasos: [
        { t: "Abajo, cargá la inversión total y la cuota mensual.", d: "Si dejás una vacía, no sale en el PDF.", marca: "Inversión total" },
        { t: "Sumá los clientes bandera: elegilos de la lista o escribilos.", d: "Quedan recordados para la próxima propuesta.", marca: "O escribí el nombre y Enter" },
      ] },
      { img: "propuestas", alt: "Botones de Propuestas", pasos: [
        { t: "Tocá Guardar para poder reabrirla después.", d: "Las guardadas se abren desde «Propuestas guardadas».", marca: "Guardar" },
        { t: "Tocá Descargar PDF y elegí «Guardar como PDF».", d: "El PDF sale igual a la hoja que ves en pantalla.", marca: "Descargar PDF" },
      ], consejo: "Si falta un servicio en el catálogo, cargalo con «Nueva pieza»: queda disponible para todas las propuestas." },
    ],
  },

  // ── Atención al cliente ───────────────────────────────────────────────────────────────
  {
    id: "chat-responder", grupo: "Atención al cliente", ruta: "/dashboard/conversaciones", titulo: "Responder los chats",
    resumen: "Encontrar un chat, abrirlo y contestarle al cliente.",
    bloques: [
      { img: "conversaciones", alt: "Bandeja de conversaciones", pasos: [
        { t: "A la izquierda están los chats. Tocá uno para abrirlo." },
        { t: "Con «Sin responder» ves solo los que esperan una respuesta.", d: "«No leídos» muestra los que tienen mensajes nuevos.", marca: "Sin responder" },
        { t: "Para encontrar a alguien, buscalo por nombre o por número.", marca: "Buscar por nombre o número" },
      ] },
      { img: "chat", alt: "Una conversación abierta", pasos: [
        { t: "Escribí abajo y apretá Enter, o tocá Enviar.", d: "Con Shift + Enter bajás de renglón sin enviar.", marca: "Escribí un mensaje… (Enter envía · Shift+Enter salto de línea)" },
      ], consejo: "Al lado del cuadro de texto están el clip para adjuntar fotos y archivos, el micrófono para un audio, los emojis y el rayo de las respuestas rápidas." },
      { ojo: "En los canales oficiales de WhatsApp, si pasaron más de 24 horas desde el último mensaje del cliente solo se puede mandar una plantilla. Arriba del chat ves cuánto queda de esa ventana." },
    ],
  },
  {
    id: "chat-transferir", grupo: "Atención al cliente", ruta: "/dashboard/conversaciones", titulo: "Pasarle un chat a otra persona",
    resumen: "Transferir la conversación a una cola o a un agente.",
    bloques: [
      { img: "chat", alt: "Una conversación abierta", pasos: [
        { t: "Con el chat abierto, tocá Transferir.", marca: "Transferir" },
      ] },
      { img: "chat-transferir", alt: "Ventana para transferir la conversación", pasos: [
        { t: "Para pasarlo a una cola, elegila arriba y tocá Transferir.", marca: "COLAS" },
        { t: "Para pasarlo a una persona, buscala en Agentes y tocá Transferir al lado de su nombre.", marca: "AGENTES" },
      ], consejo: "Debajo de cada agente ves si está disponible o en pausa y cuántos chats tiene abiertos." },
    ],
  },
  {
    id: "chat-finalizar", grupo: "Atención al cliente", ruta: "/dashboard/conversaciones", titulo: "Finalizar una conversación",
    resumen: "Cerrar el chat dejando anotado cómo terminó.",
    bloques: [
      { img: "chat", alt: "Una conversación abierta", pasos: [
        { t: "Con el chat abierto, tocá Finalizar.", marca: "Finalizar" },
      ] },
      { img: "chat-finalizar", alt: "Ventana para finalizar la conversación", pasos: [
        { t: "Elegí el estado y el subestado.", d: "Es el resultado de la conversación: queda en el historial.", marca: "ESTADO" },
        { t: "Escribí un comentario corto.", d: "Qué se resolvió o qué quedó pendiente.", marca: "COMENTARIO" },
        { t: "Si hay que volver a contactarlo, anotá la próxima acción con su fecha.", d: "Es opcional y queda en Seguimientos." },
        { t: "Tocá Confirmar finalización.", marca: "Confirmar finalización" },
      ], consejo: "Si el cliente vuelve a escribir, el chat se abre de nuevo solo." },
    ],
  },
  {
    id: "chat-ticket", grupo: "Soporte", ruta: "/dashboard/conversaciones", titulo: "Cargar un ticket desde el chat",
    resumen: "Cuando el cliente reporta un problema o pide un cambio.",
    bloques: [
      { img: "chat", alt: "Una conversación abierta", pasos: [
        { t: "Con el chat abierto, tocá Soporte.", marca: "Soporte" },
      ] },
      { img: "chat-soporte", alt: "Ventana para tipificar desde el chat", pasos: [
        { t: "Revisá que el cliente y el proyecto sean los correctos.", marca: "CLIENTE *" },
        { t: "Elegí el estado: qué tipo de pedido es.", d: "Según lo que elijas, te pide el subestado.", marca: "ESTADO *" },
        { t: "Contá qué pasa, desde cuándo y qué mensaje aparece.", d: "Cuanto más claro, más rápido se resuelve.", marca: "DESCRIPCIÓN *" },
        { t: "Tocá Guardar tipificación.", marca: "Guardar tipificación" },
      ], consejo: "El ticket se asigna solo. Si necesitás que lo tome alguien en particular, elegilo en «Asignar a» antes de guardar." },
    ],
  },

  // ── Soporte ───────────────────────────────────────────────────────────────────────────
  {
    id: "tickets", grupo: "Soporte", ruta: "/dashboard/soporte/tickets", titulo: "Seguir los tickets",
    resumen: "Ver en qué está cada ticket y encontrar los tuyos.",
    bloques: [
      { img: "tickets", alt: "Listado de tickets de soporte", pasos: [
        { t: "Arriba están los tickets separados por estado.", d: "Pendientes, En proceso, Falta información, Resueltos, Revisión cliente y Cerrados." },
        { t: "Con «Mis tickets» ves solo los que tenés asignados.", d: "«Cargados por mí» muestra los que cargaste vos.", marca: "Mis tickets" },
        { t: "Tocá un ticket para abrirlo.", d: "Adentro están la descripción, los comentarios, los archivos y el historial, y ahí se cambia el estado." },
        { t: "Para cargar uno a mano, tocá Cargar ticket.", marca: "Cargar ticket" },
      ], ojo: "Un ticket en Revisión cliente se cierra solo a las 24 horas. Si el cliente dice que sigue mal, hay que reabrirlo." },
    ],
  },

  // ── Proyectos ─────────────────────────────────────────────────────────────────────────
  {
    id: "proyecto-nuevo", grupo: "Proyectos", ruta: "/dashboard/proyectos", titulo: "Crear un proyecto",
    resumen: "Dar de alta el trabajo de un cliente para que entre a producción.",
    bloques: [
      { img: "proyectos", alt: "Tablero de proyectos", pasos: [
        { t: "Tocá Nuevo proyecto.", marca: "Nuevo proyecto" },
      ] },
      { img: "proyecto-nuevo", alt: "Formulario para crear un proyecto", pasos: [
        { t: "Poné el título del proyecto.", marca: "TÍTULO" },
        { t: "Elegí el tipo de proyecto.", d: "Según el tipo, cambian los datos que pide más abajo.", marca: "Tipo de proyecto" },
        { t: "Elegí el responsable comercial.", marca: "Responsable comercial" },
        { t: "Completá los datos y escribí en Comentarios qué necesita el cliente.", d: "Ese texto queda como primer comentario del proyecto. También podés adjuntar archivos." },
        { t: "Tocá Crear proyecto, al final del formulario." },
      ] },
    ],
  },
  {
    id: "proyecto-mover", grupo: "Proyectos", ruta: "/dashboard/proyectos", titulo: "Mover un proyecto de etapa",
    resumen: "Avanzar un proyecto, verlo en lista y dejar comentarios.",
    bloques: [
      { img: "proyectos", alt: "Tablero de proyectos", pasos: [
        { t: "Cada columna es un estado. Arrastrá la tarjeta a otra columna para moverla.", d: "También podés usar «Mover a» en la misma tarjeta.", marca: "Kanban" },
        { t: "Con Lista los ves en una tabla.", marca: "Lista" },
        { t: "Con Ordenar los acomodás del más nuevo al más viejo, o al revés.", marca: "Ordenar" },
        { t: "Tocá una tarjeta para abrirla.", d: "Adentro están los datos, los comentarios y los archivos." },
      ], consejo: "En los comentarios podés avisarle a alguien escribiendo @ y su nombre, y arrastrar archivos al cuadro de texto." },
    ],
  },

  // ── Cobros ────────────────────────────────────────────────────────────────────────────
  {
    id: "cobranzas", grupo: "Cobros", ruta: "/cobranzas", titulo: "Saber quién debe",
    resumen: "Clientes con deuda, por tramo de mora.",
    bloques: [
      { img: "cobranzas", alt: "Seguimiento de cobranzas", pasos: [
        { t: "Arriba ves el total adeudado y cuántos clientes hay en cada tramo." },
        { t: "Con las pestañas filtrás por tramo de mora.", d: "Tramo 1 es la deuda más reciente; Tramo 3, la más vieja." },
        { t: "Para encontrar a un cliente, escribilo en el buscador.", marca: "Buscar cliente, plan o tipo…" },
        { t: "Para bajar la lista, tocá Exportar Excel.", marca: "Exportar Excel" },
      ], consejo: "En cada fila, «Ver detalle» muestra las cuotas del cliente y sus pagos." },
    ],
  },

  // ── Reportes ──────────────────────────────────────────────────────────────────────────
  {
    id: "reportes", grupo: "Reportes", ruta: "/reportes", titulo: "Sacar un reporte",
    resumen: "Libros de compras y ventas, estado de cuenta y más.",
    bloques: [
      { img: "reportes", alt: "Pantalla de reportes", pasos: [
        { t: "Tocá el reporte que necesitás.", d: "Están agrupados: Contabilidad, Finanzas y cobranzas, Comercial y atención.", marca: "Libro de Ventas" },
        { t: "Adentro elegís las fechas y lo bajás en Excel." },
      ], consejo: "Si dejás el cursor sobre una tarjeta, te dice qué trae ese reporte." },
    ],
  },

  // ── Equipo ────────────────────────────────────────────────────────────────────────────
  {
    id: "usuario-nuevo", grupo: "Equipo", ruta: "/usuarios", titulo: "Crear un usuario",
    resumen: "Darle acceso al sistema a alguien del equipo.",
    bloques: [
      { img: "usuarios", alt: "Lista de usuarios", pasos: [
        { t: "Tocá Nuevo usuario.", marca: "Nuevo usuario" },
      ] },
      { img: "usuario-nuevo", alt: "Formulario para crear un usuario", pasos: [
        { t: "Escribí el nombre completo.", marca: "Ej: JUAN PÉREZ" },
        { t: "Escribí su correo.", d: "Con ese correo va a entrar al sistema.", marca: "usuario@empresa.com" },
        { t: "Más abajo, elegí el nivel de acceso.", d: "Usuario, Supervisor o Administrador.", marca: "Nivel de acceso" },
        { t: "Al final, poné una contraseña de al menos 6 caracteres y tocá Guardar usuario." },
      ], ojo: "Administrador ve y puede cambiar todo. Dalo solo a quien de verdad lo necesita." },
    ],
  },
  {
    id: "guardias", grupo: "Equipo", ruta: "/dashboard/guardias", titulo: "Cargar las guardias",
    resumen: "Quién queda de turno cada semana.",
    bloques: [
      { img: "guardias", alt: "Guardias de la semana", pasos: [
        { t: "Cada bloque es una semana.", marca: "Guardias de la semana" },
        { t: "Elegí el PM de guardia, el soporte principal y el suplente." },
        { t: "Si hace falta, dejá una nota para el equipo.", d: "Por ejemplo: feriado el viernes." },
        { t: "Tocá Guardar en esa semana.", marca: "Guardar" },
      ], consejo: "Todo el equipo ve quién está de guardia con el botón Guardias, arriba a la derecha." },
    ],
  },
];
