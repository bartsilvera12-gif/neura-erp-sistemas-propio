import DeviceRouter from "@/shared/device/DeviceRouter";
import ProduccionClient from "./ProduccionClient";

export const dynamic = "force-dynamic";

// Mobile es Fase 2 → sin prop `mobile`, DeviceRouter cae a desktop.
export default function ProduccionPage() {
  return <DeviceRouter desktop={<ProduccionClient />} />;
}
