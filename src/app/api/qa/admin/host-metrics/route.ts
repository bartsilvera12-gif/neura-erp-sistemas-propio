/**
 * GET /api/qa/admin/host-metrics
 *
 * Endpoint read-only que lee /proc/meminfo, /proc/loadavg y el filesystem root
 * desde adentro del container del QA Center. En Linux containers:
 *   - /proc/meminfo expone la RAM del host (no está por-namespace)
 *   - /proc/loadavg es del host (loadavg es global)
 *   - df del rootfs del container muestra el volumen sobre el que corre
 *     el motor Docker del host — proxy razonable de espacio libre
 *
 * Este endpoint NO modifica nada. Solo lee. Autorizado por el gate QA Center.
 */

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { statfs } from "node:fs";
import { promisify } from "node:util";
import { authenticateRunner } from "@/lib/qa/runner-auth";
import { buildQaNonceStore } from "@/lib/qa/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statfsAsync = promisify(statfs);

export async function GET(request: Request) {
  // Auth via HMAC del runner — mismo secret que el resto de endpoints runner.
  // Read-only, no datos sensibles.
  const nonceStore = buildQaNonceStore();
  if (!nonceStore) return NextResponse.json({ error: "QA_DB_URL no configurada", code: "internal" }, { status: 500 });
  const auth = await authenticateRunner(request, nonceStore);
  if (!auth.ok) return auth.response;

  const [meminfo, loadavg, cpuinfo, diskRoot, diskData] = await Promise.all([
    readFile("/proc/meminfo", "utf8").catch(() => null),
    readFile("/proc/loadavg", "utf8").catch(() => null),
    readFile("/proc/cpuinfo", "utf8").catch(() => null),
    statfsAsync("/").catch(() => null),
    statfsAsync("/app").catch(() => null),
  ]);

  const parseMemKb = (file: string, key: string): number | null => {
    const m = file.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, "m"));
    return m ? Number.parseInt(m[1]!, 10) : null;
  };
  const mem = meminfo ? {
    total_mb: Math.round((parseMemKb(meminfo, "MemTotal") ?? 0) / 1024),
    available_mb: Math.round((parseMemKb(meminfo, "MemAvailable") ?? 0) / 1024),
    free_mb: Math.round((parseMemKb(meminfo, "MemFree") ?? 0) / 1024),
    buffers_mb: Math.round((parseMemKb(meminfo, "Buffers") ?? 0) / 1024),
    cached_mb: Math.round((parseMemKb(meminfo, "Cached") ?? 0) / 1024),
  } : null;

  const load = loadavg ? (() => {
    const p = loadavg.trim().split(/\s+/);
    return { load_1m: Number(p[0]), load_5m: Number(p[1]), load_15m: Number(p[2]), running_procs: p[3] };
  })() : null;

  const cpuCount = cpuinfo ? (cpuinfo.match(/^processor\s*:/gm) ?? []).length : null;

  const fsToObj = (fs: NonNullable<typeof diskRoot>) => ({
    total_gb: Math.round((fs.blocks * fs.bsize) / (1024 ** 3) * 10) / 10,
    free_gb:  Math.round((fs.bfree  * fs.bsize) / (1024 ** 3) * 10) / 10,
    avail_gb: Math.round((fs.bavail * fs.bsize) / (1024 ** 3) * 10) / 10,
  });

  return NextResponse.json({
    note: "métricas leídas desde dentro del container QA Center. mem/load reflejan al host (namespaces de Linux); df es el volumen montado del container, útil como cota inferior de espacio del host.",
    read_at: new Date().toISOString(),
    cpu_count_from_cpuinfo: cpuCount,
    memory: mem,
    load: load,
    disk_root: diskRoot ? fsToObj(diskRoot) : null,
    disk_app: diskData ? fsToObj(diskData) : null,
  });
}
