"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { tieneAccesoMovilEspecial } from "@/lib/auth/acceso-movil-especial";
import CapacitorPushRegister from "@/components/CapacitorPushRegister";

/**
 * Monta el registro de push FCM SOLO para el acceso móvil especial.
 *
 * Por qué va gateado: el registro nativo de push crashea en APKs compiladas SIN
 * `google-services.json` (por eso el PR #4 lo desactivó en el inbox). Hoy solo el usuario
 * del acceso móvil especial tiene una APK nueva con ese archivo; los asesores siguen con la
 * APK vieja, así que para ellos NO se monta y quedan EXACTAMENTE como hasta ahora (sin push
 * y sin crash). Cuando todas las APKs tengan el json, se puede quitar este gate y montar
 * `CapacitorPushRegister` para todos.
 *
 * En navegador/desktop `CapacitorPushRegister` ya es no-op (no es Capacitor nativo); igual lo
 * gateamos para no montarlo fuera del único caso que hoy lo necesita.
 */
export default function MAsesorPushGate() {
  const [habilitado, setHabilitado] = useState(false);

  useEffect(() => {
    let activo = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (activo) setHabilitado(tieneAccesoMovilEspecial(data.session?.user.email));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setHabilitado(tieneAccesoMovilEspecial(session?.user.email));
    });
    return () => {
      activo = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return habilitado ? <CapacitorPushRegister /> : null;
}
