import ProjectManagersClient from "./ProjectManagersClient";

/**
 * Gestión Project Manager: los PM de la empresa y la cartera de clientes de
 * cada uno. No necesita `dataSchema` porque todo pasa por la API.
 */
export default function Page() {
  return <ProjectManagersClient />;
}
