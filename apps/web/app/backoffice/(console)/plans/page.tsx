import { fetchAgencies } from "../../../../lib/backoffice";
import { PlansView } from "./PlansView";

/** Plan-tier editor (B9, D2): agency-level STARTER/GROWTH/SCALE rows with
 *  admin-set limits. Saving stamps `confirmed` — the moment tier numbers stop
 *  being proposals — and audits the change. */
export default async function PlansPage() {
  const agencies = await fetchAgencies();
  return <PlansView agencies={agencies} />;
}
