import { NextRequest, NextResponse } from "next/server";
import { fetchTransferTargetAgents, listTransferQueues } from "@/lib/chat/chat-ops-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Endpoint HTTP para alimentar el modal "Transferir conversación" del chat móvil.
 *
 * Antes se invocaban directamente los server actions `listTransferQueues` y
 * `fetchTransferTargetAgents` desde el componente del móvil. En producción Next 15 fallaba
 * al serializar la respuesta via server action ("An error occurred in the Server
 * Components render" enmascarado), aunque las mismas funciones devueltas por HTTP route
 * (via NextResponse.json) andaban perfecto. Este endpoint es el camino HTTP equivalente
 * y evita la serialización de RSC.
 */
export async function GET(req: NextRequest) {
  try {
    const [queues, agents] = await Promise.all([
      listTransferQueues(req).catch((e: unknown) => {
        throw new Error(`queues: ${e instanceof Error ? e.message : String(e)}`);
      }),
      fetchTransferTargetAgents(req).catch((e: unknown) => {
        throw new Error(`agents: ${e instanceof Error ? e.message : String(e)}`);
      }),
    ]);
    return NextResponse.json({ ok: true, queues, agents });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
