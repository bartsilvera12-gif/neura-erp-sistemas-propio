import { redirect } from "next/navigation";

/** La portada de Caja del 2.0: en Neura se entra directo a vender. */
export default function Page() {
  redirect("/caja/nueva");
}
