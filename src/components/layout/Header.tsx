"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, ChevronDown, HelpCircle, LogOut, Menu } from "lucide-react";
import { hrefFamilia, useMenuVisible } from "@/lib/menu/menu-visible-store";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { signOut } from "@/lib/auth";
import NotificacionesBell from "@/components/layout/NotificacionesBell";
import ChatPestanaBadge from "@/components/layout/ChatPestanaBadge";
import GuardiasBoton from "@/components/layout/GuardiasBoton";
import AvisoReunion from "@/components/layout/AvisoReunion";

type HeaderUsuario = {
  nombre: string | null;
  rol: string | null;
  email: string | null;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function roleLabel(rol: string | null | undefined): string {
  const r = clean(rol).toLowerCase();
  const labels: Record<string, string> = {
    admin: "Admin",
    administrador: "Admin",
    super_admin: "Super admin",
    supervisor: "Supervisor",
    vendedor: "Vendedor",
    asesor: "Asesor",
    comercial: "Comercial",
    "asesor comercial": "Asesor comercial",
    usuario: "Usuario",
  };
  if (labels[r]) return labels[r];
  if (!r) return "Usuario";
  return r
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

type HeaderProps = {
  onOpenMobileSidebar?: () => void;
};

export default function Header({ onOpenMobileSidebar }: HeaderProps = {}) {
  const router = useRouter();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [usuario, setUsuario] = useState<HeaderUsuario | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadUsuario() {
      try {
        const res = await fetchWithSupabaseSession("/api/usuarios/me", { cache: "no-store" });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const json = (await res.json()) as { usuario?: HeaderUsuario };
        if (alive) setUsuario(json.usuario ?? null);
      } catch {
        if (alive) setUsuario(null);
      }
    }
    void loadUsuario();
    return () => {
      alive = false;
    };
  }, []);

  const nombreReal = clean(usuario?.nombre);
  const fallbackEmail = clean(usuario?.email);
  const displayName = nombreReal || fallbackEmail || "Usuario";
  const dropdownName = nombreReal || "Usuario";
  const avatarInitial = (nombreReal || fallbackEmail || "Usuario").charAt(0).toUpperCase();
  const displayRole = roleLabel(usuario?.rol);

  return (
    <header
      id="neura-header"
      className="z-40 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200/90 bg-white/95 px-3 sm:px-6 shadow-[inset_0_-1px_0_0_rgba(10,37,64,0.05)] backdrop-blur-sm"
    >
      {/* Hamburguesa: solo mobile. Abre el sidebar como sheet desde la izquierda. */}
      <button
        type="button"
        onClick={() => onOpenMobileSidebar?.()}
        aria-label="Abrir menú"
        className="-ml-1 flex h-11 w-11 items-center justify-center rounded-lg text-[#475569] transition-colors hover:bg-slate-50 hover:text-[#0EA5E9] md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>
      {/* A la izquierda: volver a la portada de la familia de esta pantalla (como el "← Comercial" de 2.0). */}
      <VolverAPortada />

      {/* Mi reunión en curso o la próxima de hoy (de la agenda), en el espacio libre del medio. */}
      <AvisoReunion />

      <div className="flex items-center gap-2">
        {/* Asistente de ayuda (Neurita) — desactivado temporalmente. */}

        {/* Manual: guías paso a paso con capturas (como el de 2.0). */}
        <Link
          href="/manual"
          title="Manual"
          aria-label="Manual"
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-[#475569] transition-colors hover:bg-slate-50 hover:text-[#0EA5E9]"
        >
          <BookOpen className="h-5 w-5 shrink-0" />
          <span className="hidden lg:inline">Manual</span>
        </Link>
        {/* Ayuda en línea — acceso transversal, disponible en cualquier pantalla. */}
        <Link
          href="/ayuda"
          title="Ayuda en línea"
          aria-label="Ayuda en línea"
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-[#475569] transition-colors hover:bg-slate-50 hover:text-[#0EA5E9]"
        >
          <HelpCircle className="h-5 w-5 shrink-0" />
          <span className="hidden lg:inline">Ayuda en línea</span>
        </Link>

        {/* Guardias: visible para todo el equipo. Ver quién está de turno no
            pide permisos; asignar sigue siendo de administradores (el enlace
            "Asignar" del modal y el PUT de la API lo controlan). */}
        <GuardiasBoton />

        {/* Notificaciones */}
        <NotificacionesBell />
        {/* No dibuja nada: pone el contador del chat en la pestaña. Va acá
            porque el Header está en todas las pantallas, y el sentido del
            contador es avisar justamente cuando no se está mirando el chat. */}
        <ChatPestanaBadge />

        {/* Avatar + menú usuario */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 transition-colors hover:bg-slate-100"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--zentra-sidebar)] text-white ring-1 ring-sky-400/35">
              <span className="text-sm font-bold">{avatarInitial}</span>
            </div>
            <div className="hidden text-left sm:block">
              <p className="max-w-[180px] truncate text-sm font-medium text-[#0F172A]">{displayName}</p>
              <p className="text-xs text-[#475569]">{displayRole}</p>
            </div>
            <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${userMenuOpen ? "rotate-180" : ""}`} />
          </button>

          <div
            className={`absolute right-0 top-full mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg ${
              userMenuOpen ? "block" : "hidden"
            }`}
          >
            <div className="border-b border-slate-200 px-4 py-2">
              <p className="truncate text-sm font-medium text-[#0F172A]">{dropdownName}</p>
            </div>
            <button
              type="button"
              onClick={async () => {
                await signOut();
                router.push("/login");
              }}
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[#475569] transition-colors hover:bg-slate-50 hover:text-[#0EA5E9]"
            >
              <LogOut className="h-4 w-4" />
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * "← Comercial · Clientes": el menú lateral ya no lista cada pantalla, así que
 * este link es la vuelta a la portada sin pasar por el menú. Sale del mismo
 * menú visible que arma el Sidebar; en el Dashboard y en las portadas no se muestra.
 */
function VolverAPortada() {
  const pathname = usePathname() ?? "";
  const { familias } = useMenuVisible();
  let mejor: { familia: string; id: string; pantalla: string; largo: number } | null = null;
  for (const f of familias) {
    if (f.id === "inicio" || f.pantallas.length < 2) continue;
    for (const p of f.pantallas) {
      const coincide = pathname === p.href || pathname.startsWith(`${p.href}/`);
      if (coincide && (!mejor || p.href.length > mejor.largo)) {
        mejor = { familia: f.title, id: f.id, pantalla: p.label, largo: p.href.length };
      }
    }
  }
  if (!mejor) return <span className="hidden md:block" />;
  return (
    <nav aria-label="Ubicación" className="hidden min-w-0 items-center gap-2 text-[13px] md:flex">
      <Link
        href={hrefFamilia(mejor.id)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-[#3F8E91]"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {mejor.familia}
      </Link>
      <span aria-hidden className="text-slate-300">/</span>
      <span className="truncate font-semibold text-slate-800">{mejor.pantalla}</span>
    </nav>
  );
}
