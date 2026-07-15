import { fetchAgencies } from "../../../../lib/backoffice";
import { PricingView } from "./PricingView";

/** Credit-price editor (FR-BILL-02): effective-dated platform defaults + per-agency
 *  overrides + change history. Appends CreditPrice rows; every change is audited. */
export default async function PricingPage() {
  const agencies = await fetchAgencies();
  return <PricingView agencies={agencies} />;
}
