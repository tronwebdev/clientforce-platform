import { fetchAgencies, fetchKillSwitches } from "../../../../lib/backoffice";
import { KillSwitchesView } from "./KillSwitchesView";

/**
 * Kill switches (FR-ADMIN-04): per-agency, per-channel emergency stop. Setting
 * one active makes the send boundary refuse `CHANNEL_KILLED` for that agency +
 * channel — the same machinery as W1 tenant suspension, one scope narrower.
 * Every change is audited; clearing restores sending.
 */
export default async function KillSwitchesPage() {
  const [agencies, switches] = await Promise.all([fetchAgencies(), fetchKillSwitches()]);
  return <KillSwitchesView agencies={agencies} initialSwitches={switches} />;
}
