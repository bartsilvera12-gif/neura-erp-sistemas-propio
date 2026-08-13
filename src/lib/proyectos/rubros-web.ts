/**
 * Catálogo de rubros de negocio para proyectos web (campo brief `tipo_web`).
 * Antes era texto libre → valores inconsistentes ("TIENDA VIRTUAL", "tienda virtual",
 * "Store", "TINEDA VIRTUAL"…). Ahora se elige de esta lista (con buscador) y se guarda
 * la ETIQUETA canónica, para poder reportar/filtrar por rubro.
 */

export type RubroWeb = {
  /** Etiqueta canónica que se guarda en brief_data.tipo_web. */
  label: string;
  /** Palabras clave para el buscador y para asociar valores viejos de texto libre. */
  aliases: string[];
};

export const RUBROS_WEB: RubroWeb[] = [
  { label: "Tienda virtual / e-commerce", aliases: ["tienda virtual", "tienda online", "ecommerce", "e-commerce", "store", "shop", "amazon", "tineda", "tienda"] },
  { label: "Institucional / corporativa", aliases: ["institucional", "corporativa", "corporativo", "empresa", "informativa"] },
  { label: "Landing page", aliases: ["landing", "landing page", "one page", "pagina simple"] },
  { label: "Inmobiliaria", aliases: ["inmobiliaria", "inmuebles", "inmobiliario", "propiedades", "real estate"] },
  { label: "Automotor (autos)", aliases: ["automotor", "autos", "auto", "vehiculos", "alquiler de autos", "rent a car", "concesionaria"] },
  { label: "Ganadería / agro", aliases: ["ganaderia", "agro", "agropecuaria", "campo", "rural", "agricultura"] },
  { label: "Gastronomía / restaurante", aliases: ["gastronomia", "restaurante", "resto", "comida", "delivery", "cafeteria"] },
  { label: "Salud / clínica / consultorio", aliases: ["salud", "clinica", "consultorio", "medico", "medica", "odontologia", "doctor"] },
  { label: "Belleza / spa / estética", aliases: ["belleza", "spa", "estetica", "uñas", "unas", "peluqueria", "nails"] },
  { label: "Educación / cursos / academia", aliases: ["educacion", "cursos", "academia", "escuela", "capacitacion", "e-learning", "elearning"] },
  { label: "Turismo / hotelería", aliases: ["turismo", "hoteleria", "hotel", "viajes", "posada", "hospedaje"] },
  { label: "Eventos", aliases: ["eventos", "evento", "fiestas", "organizacion de eventos"] },
  { label: "Ferretería / construcción", aliases: ["ferreteria", "construccion", "materiales", "corralon"] },
  { label: "Moda / indumentaria", aliases: ["moda", "indumentaria", "ropa", "boutique", "vestimenta", "fashion"] },
  { label: "Electrónica / tecnología", aliases: ["electronica", "tecnologia", "tech", "celulares", "computacion", "gadgets"] },
  { label: "Electrodomésticos", aliases: ["electrodomesticos", "electrodomestico", "linea blanca"] },
  { label: "Librería / papelería", aliases: ["libreria", "papeleria", "utiles", "libros"] },
  { label: "Joyería / accesorios", aliases: ["joyeria", "joyas", "accesorios", "bijou", "relojeria"] },
  { label: "Servicios profesionales", aliases: ["servicios", "servicio profesional", "estudio", "agencia", "consultora"] },
  { label: "Deportes / gimnasio", aliases: ["deportes", "gimnasio", "gym", "fitness", "crossfit"] },
  { label: "Mascotas / veterinaria", aliases: ["mascotas", "veterinaria", "pet", "petshop", "vet"] },
  { label: "Blog / portal de contenidos", aliases: ["blog", "portal", "contenidos", "noticias", "revista"] },
  { label: "Portfolio personal", aliases: ["portfolio", "portafolio", "personal", "cv"] },
  { label: "Otro", aliases: ["otro", "otros", "con panel de control", "con panel administrador", "panel"] },
];

const norm = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Etiquetas canónicas (para el select). */
export const RUBROS_WEB_LABELS: string[] = RUBROS_WEB.map((r) => r.label);

/**
 * Asocia un valor de texto libre a la etiqueta canónica del catálogo.
 * Devuelve `null` si no matchea con confianza (para revisar a mano / dejar "Otro").
 */
export function asociarRubroWeb(raw: string | null | undefined): string | null {
  const q = norm(String(raw ?? ""));
  if (!q) return null;
  // 1) match exacto de etiqueta.
  for (const r of RUBROS_WEB) if (norm(r.label) === q) return r.label;
  // 2) match por alias contenido en el texto (o el texto contenido en el alias).
  for (const r of RUBROS_WEB) {
    for (const a of r.aliases) {
      const na = norm(a);
      if (na && (q.includes(na) || na.includes(q))) return r.label;
    }
  }
  return null;
}
