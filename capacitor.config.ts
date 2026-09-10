/**
 * Configuración Capacitor para la APK del asesor (Neura ERP).
 *
 * Va como objeto plano (sin `import type { CapacitorConfig }`) a propósito: así este
 * archivo es TS válido SIN requerir @capacitor/cli en el build web. Cuando se prepare
 * el entorno nativo (ver docs/CAPACITOR_PUSH_SETUP.md) se instala Capacitor y, si se
 * quiere, se puede tipar con CapacitorConfig.
 *
 * Estrategia: la APK carga el ERP remoto (server.url) en un WebView Android; las rutas
 * /m/asesor viven en el mismo Next ya deployado (sistemas.neura.com.py). El plugin nativo
 * de Push Notifications registra el token FCM y lo envía a POST /api/cc/agent/device-token;
 * al tocar la notificación abre `data.route` (/m/asesor/chat/[conversationId]).
 *
 * package / app name: py.com.neura.erp · "Zentra ERP". El package queda con "neura"
 * a propósito: está atado a Firebase, APNs y los perfiles de firma, y el usuario no lo ve.
 */
const config = {
  appId: "py.com.neura.erp",
  appName: "Zentra ERP",
  // webDir es requerido por Capacitor; con server.url (remoto) casi no se usa.
  webDir: "public",
  server: {
    // La app abre directamente la vista del asesor en el ERP deployado.
    url: "https://sistemas.neura.com.py/m/asesor",
    cleartext: false,
    allowNavigation: ["sistemas.neura.com.py", "*.neura.com.py", "api.neura.com.py"],
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
