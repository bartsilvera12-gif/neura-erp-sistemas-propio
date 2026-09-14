"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TicketPlus } from "lucide-react";
import FormTicket, { VALORES_VACIOS } from "../../_ui/FormTicket";
import { apiSoporte, subirArchivos } from "../../_ui/api";
import { Aviso, Encabezado, Pagina } from "../../_ui/ui";

export default function SoporteNuevoTicketPage() {
  const router = useRouter();
  const [avisoArchivos, setAvisoArchivos] = useState<string | null>(null);

  return (
    <Pagina ancho="max-w-[1100px]">
      <Encabezado
        titulo="Nuevo ticket"
        subtitulo="Crear un nuevo ticket de soporte"
        icono={TicketPlus}
        tono="turquesa"
        migas={[{ etiqueta: "Tickets", href: "/dashboard/soporte/tickets" }, { etiqueta: "Nuevo" }]}
      />
      {avisoArchivos ? (
        <div className="mb-4">
          <Aviso>{avisoArchivos}</Aviso>
        </div>
      ) : null}
      <FormTicket
        modo="crear"
        inicial={VALORES_VACIOS}
        cancelarHref="/dashboard/soporte/tickets"
        onGuardar={async (v, archivos) => {
          const creado = await apiSoporte<{ id: string; numero: number }>("/api/soporte/tickets", {
            method: "POST",
            json: v,
          });
          // El ticket ya existe: si alguna evidencia falla, se avisa pero no se
          // pierde el ticket. Se puede volver a subir desde la pestaña Archivos.
          if (archivos.length) {
            const r = await subirArchivos(creado.id, archivos);
            if (r.errores.length) {
              setAvisoArchivos(
                `El ticket #${creado.numero} se creó, pero ${r.errores.length} archivo(s) no se subieron: ${r.errores.join(" · ")}`
              );
              window.setTimeout(() => router.push(`/dashboard/soporte/tickets/${creado.id}/archivos`), 3500);
              return;
            }
          }
          router.push(`/dashboard/soporte/tickets/${creado.id}`);
        }}
      />
    </Pagina>
  );
}
