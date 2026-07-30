import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import AppShell from "../components/AppShell";
import MobileAppShell from "../mobile/layout/MobileAppShell";
import DeviceRouter from "../shared/device/DeviceRouter";
import SWRPersistedProvider from "../shared/swr/SWRPersistedProvider";
import { ThemeProvider } from "../components/ThemeProvider";
import AuthGuard from "../components/AuthGuard";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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