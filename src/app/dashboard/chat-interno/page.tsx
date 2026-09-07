import DeviceRouter from "@/shared/device/DeviceRouter";
import ChatInternoClient from "./ChatInternoClient";

export const dynamic = "force-dynamic";

// Mobile queda para una segunda fase: el chat de dos paneles necesita su propio
// diseño en pantalla chica y no una versión apretada del de escritorio.
export default function ChatInternoPage() {
  return <DeviceRouter desktop={<ChatInternoClient />} />;
}
