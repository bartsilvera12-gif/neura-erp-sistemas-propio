import { NextRequest, NextResponse } from "next/server";
import { fetchTransferTargetAgents, listTransferQueues } from "@/lib/chat/chat-ops-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Endpoint diagnóstico: replica el flow del modal "Transferir conversación" del chat móvil
 * y devuelve resultado + mensaje de error con stack trace cuando algo lanza. Pensado para
 * destrabar casos como el de Karen, donde el server action falla en producción y Next oculta
 * el mensaje. NO expone datos sensibles — devuelve conteos y la primera línea del stack.
 */
export async function GET(_req: NextRequest) {
  const result: Record<string, unknown> = {};
  try {
    const q = await listTransferQueues();
    result.queues = { ok: true, count: q.length, sample: q.slice(0, 3).map((x) => ({ id: x.id, nombre: x.nombre })) };
  } catch (e) {
    result.queues = {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? (e.stack?.split("\n").slice(0, 6).join("\n") ?? null) : null,
    };
  }
  try {
    const a = await fetchTransferTargetAgents();
    result.agents = {
      ok: true,
      count: a.length,
      sample: a.slice(0, 3).map((x) => ({ nombre: x.nombre, queue: x.queue_nombre })),
    };
  } catch (e) {
    result.agents = {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? (e.stack?.split("\n").slice(0, 6).join("\n") ?? null) : null,
    };
  }
  return NextResponse.json(result, { status: 200 });
}
