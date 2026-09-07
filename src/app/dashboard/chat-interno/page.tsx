import DeviceRouter from "@/shared/device/DeviceRouter";
import ChatInternoClient from "./ChatInternoClient";

export const dynamic = "force-dynamic";

export default function ChatInternoPage() {
  return (
    <DeviceRouter
      desktop={<ChatInternoClient />}
      mobile={<ChatInternoClient mobile />}
    />
  );
}
