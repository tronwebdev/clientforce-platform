import { fetchAgencies } from "../../../../lib/backoffice";
import { UsageView } from "./UsageView";

/** Per-tenant consumption (FR-ADMIN-02): sends by channel, voice minutes, credit
 *  burn — from the event + credit ledgers. AI spend is honestly "not yet metered". */
export default async function UsagePage() {
  const agencies = await fetchAgencies();
  return <UsageView agencies={agencies} />;
}
