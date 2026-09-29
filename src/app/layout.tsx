import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import AppShell from "../components/AppShell";
import MobileAppShell from "../mobile/layout/MobileAppShell";
import DeviceRouter from "../shared/device/DeviceRouter";
import SWRPersistedProvider from "../shared/swr/SWRPersistedProvider";
import { ThemeProvider } from "../components/ThemeProvider";
import AuthGuard from "../components/AuthGuard";
import "./globals.css";

/**
 * Fuentes locales, no `next/font/google`: con Google, `next build` descarga las fuentes en medio
 * del build y, si esa descarga se corta (build server cargado, red), aborta el deploy entero
 * ("Failed to fetch `Plus Jakarta Sans` from Google Fonts"). Son los mismos archivos que Google
 * entregaba (subset latino, fuentes variables: un archivo cubre todos los pesos). Licencia OFL.
 */
const plusJakarta = localFont({
  src: "./fonts/plus-jakarta-sans-latin.woff2",
  variable: "--font-plus-jakarta",
  weight: "300 800",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Neura ERP",
  description: "Sistema de gestión empresarial de Neura",
  // Pedimos a los navegadores que NO traduzcan la app. El traductor automático de Chrome/Google
  // reescribe el DOM (envuelve textos en <font>), y eso rompe la reconciliación de React con
  // errores "Failed to execute 'removeChild' on 'Node'" (crash de páginas dinámicas como Comisiones).
  other: { google: "notranslate" },
};

/**
 * `viewport-fit=cover` habilita las variables `env(safe-area-inset-*)` en iOS (notch/barra de
 * estado). Sin esto devuelven 0 y los headers con padding de safe-area se solapaban con el reloj
 * del iPhone. Los inset valen 0 en desktop/Android sin notch, así que no afecta esas plataformas.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" translate="no" className="notranslate" suppressHydrationWarning>
      <body className={`${plusJakarta.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider>
          <SWRPersistedProvider>
            <AuthGuard>
              <DeviceRouter
                desktop={<AppShell>{children}</AppShell>}
                mobile={<MobileAppShell>{children}</MobileAppShell>}
              />
            </AuthGuard>
          </SWRPersistedProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}