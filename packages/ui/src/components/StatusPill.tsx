export type ContactStatus = "new" | "replied" | "qualified" | "booked" | "unsubscribed";

const LABELS: Record<ContactStatus, string> = {
  new: "New",
  replied: "Replied",
  qualified: "Qualified",
  booked: "Booked",
  unsubscribed: "Unsubscribed",
};

export interface StatusPillProps {
  status: ContactStatus;
  /** Override the label (e.g. "Meeting booked"); colors stay by status. */
  label?: string;
}

/**
 * The contact/lead status color vocabulary, shipped once in packages/ui (not
 * per-screen) — values verbatim from the Contacts prototype's `ST` map:
 * New #F2EEE4/#8A7F6B · Replied rgba(54,215,237,.16)/#1192A6 · Qualified
 * rgba(53,232,52,.14)/#16A82A · Booked #D7F5DD/#0F7A28 · Unsubscribed
 * rgba(224,121,107,.16)/#C9543F.
 */
export function StatusPill({ status, label }: StatusPillProps) {
  return <span className={`cf-status cf-status--${status}`}>{label ?? LABELS[status]}</span>;
}
