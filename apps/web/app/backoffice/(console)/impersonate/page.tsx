import { fetchAgencies } from "../../../../lib/backoffice";
import { ImpersonateView } from "./ImpersonateView";

/**
 * Read-only impersonation (FR-ADMIN-05). Start a session against a workspace with
 * a mandatory reason (audited as `impersonate.start`); the viewer then shows a
 * prominent read-only banner and rendered message previews. There is NO write
 * path to tenant content anywhere on this surface.
 */
export default async function ImpersonatePage() {
  const agencies = await fetchAgencies();
  return <ImpersonateView agencies={agencies} />;
}
