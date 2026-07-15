import { fetchAgencies } from "../../../../lib/backoffice";
import { FlagsView } from "./FlagsView";

/**
 * Per-tenant feature flags (FR-ADMIN-06): workspace-scoped toggles set by the
 * operator (audited). Pick a workspace, then flip flags on/off. Reads and writes
 * go through the `/api/bo` proxy; the flag store is backoffice-written only.
 */
export default async function FlagsPage() {
  const agencies = await fetchAgencies();
  return <FlagsView agencies={agencies} />;
}
