import DeviceRouter from "@/shared/device/DeviceRouter";
import DireccionClient from "./DireccionClient";

export const dynamic = "force-dynamic";

// Mobile no aplica: es un tablero de escritorio.
export default function DireccionPage() {
  return <DeviceRouter desktop={<DireccionClient />} />;
}
