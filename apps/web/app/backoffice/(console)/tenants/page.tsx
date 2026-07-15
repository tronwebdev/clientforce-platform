import { fetchAgencies } from "../../../../lib/backoffice";
import { TenantsView } from "./TenantsView";

/** Tenant management (FR-ADMIN-01): agencies + workspaces, search, suspend,
 *  reactivate, manual credit grants. Server-fetches the first page; the view
 *  handles search + mutations through the `/api/bo` proxy. */
export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const agencies = await fetchAgencies(sp.q);
  return <TenantsView initial={agencies} initialQuery={sp.q ?? ""} />;
}
