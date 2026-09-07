import DeviceRouter from "@/shared/device/DeviceRouter";
import TablerosClient from "./TablerosClient";

export const dynamic = "force-dynamic";

// Mobile no aplica: es un tablero de escritorio.
export default function TablerosPage() {
  return <DeviceRouter desktop={<TablerosClient />} />;
}
