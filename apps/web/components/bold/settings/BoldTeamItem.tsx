"use client";

/**
 * Team and roles (SURFACE_SPEC_SETTINGS §7) — People · What roles can do.
 *
 * Ada is a row here, not a feature: she acts inside the same guardrails and
 * every action she takes lands on the same timeline, so leaving her off the
 * team page would be the misleading choice.
 *
 * The invite drawer's states are all real and all reachable: pending, resend,
 * revoke, expired, and the honest "created but not sent" state that exists
 * because nothing is wired to deliver the mail yet. Last-owner protection is
 * enforced by the server; this surface explains it rather than pretending to
 * be the thing enforcing it.
 */
import { useState } from "react";
import { mono } from "../bold-cards";
import {
  AddRow,

  ChoiceRow,
  DrawerError,
  EYEBROW,
  PrimaryButton,
  RowList,
  SettingsDrawer,
  StepDots,
  StepPrompt,
  Well,
  type SettingsRow,
} from "../bold-settings-kit";
import type { WorkspaceMemberRow } from "../bold-live";
import {
  removeMember,
  resendInvite,
  revokeInvite,
  sendInvite,
  setMemberRole,
  type InviteRow,
  type WorkspaceRole,
} from "../bold-settings-live";
import { BoldItemPage, EmptyTab, TabNote, type ItemHeader } from "./BoldItemPage";
import { pluralise, type SettingsSnapshot } from "./settings-data";

type Drawer = { t: "invite" } | { t: "person"; member: WorkspaceMemberRow } | { t: "pending"; invite: InviteRow };

const TABS = ["People", "What roles can do"];

/** The shipped enum's words, with the scope sentence each one actually has. */
const ROLE_SCOPE: Record<WorkspaceRole, string> = {
  OWNER: "Everything, including senders, guardrails, credits and who is on the team",
  ADMIN: "Campaigns, inbox, contacts and settings — not billing, not the workspace itself",
  AGENT: "Works the inbox and runs campaigns — cannot change guardrails",
  VIEWER: "Reads everything, sends nothing",
};

const ROLE_WORD: Record<WorkspaceRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  AGENT: "Agent",
  VIEWER: "Viewer",
};

const INVITABLE: Array<{ role: "ADMIN" | "AGENT" | "VIEWER"; title: string; sub: string }> = [
  { role: "ADMIN", title: "Admin", sub: "Everything except billing and deleting the workspace." },
  { role: "AGENT", title: "Agent", sub: "Works the inbox, runs campaigns, cannot change guardrails." },
  { role: "VIEWER", title: "Viewer", sub: "Reads everything, sends nothing." },
];

function inviteSub(i: InviteRow): string {
  const who = i.invitedBy ? `Invited by ${i.invitedBy}` : "Invited";
  if (i.state === "expired") return `${who} · the link lapsed, so it no longer works`;
  if (i.state === "revoked") return `${who} · revoked`;
  if (i.state === "accepted") return `${who} · they joined`;
  const days = Math.max(0, Math.ceil((new Date(i.expiresAt).getTime() - Date.now()) / 86_400_000));
  const resends = i.resendCount > 0 ? ` · sent ${i.resendCount + 1} times` : "";
  return `${who} · ${ROLE_WORD[i.role]} · expires in ${pluralise(days, "day", "days")}${resends}`;
}

export function BoldTeamItem({
  data,
  reload,
  flash,
  onBack,
  onHeader,
}: {
  data: SettingsSnapshot;
  reload: () => Promise<void>;
  flash: (m: string) => void;
  onBack: () => void;
  onHeader: (h: ItemHeader | null) => void;
}) {
  const [tab, setTab] = useState(0);
  const [drawer, setDrawer] = useState<Drawer | null>(null);

  const members = data.members ?? [];
  const invites = data.invites ?? [];
  const open = invites.filter((i) => i.state === "pending" || i.state === "expired");
  const owners = members.filter((m) => m.role === "OWNER");

  async function done(toast: string) {
    setDrawer(null);
    flash(toast);
    await reload();
  }

  const stats = [
    { label: "PEOPLE", value: String(members.length), sub: "plus Ada", tone: "ink" as const },
    {
      label: "OWNERS",
      value: String(owners.length),
      sub: owners.length === 1 ? "just one" : "shared",
      tone: "forest" as const,
    },
    {
      label: "PENDING INVITES",
      value: String(open.filter((i) => i.state === "pending").length),
      sub: open.length === 0 ? "nobody waiting" : open.some((i) => i.state === "expired") ? "one has lapsed" : "waiting to join",
      tone: open.some((i) => i.state === "expired") ? ("amber" as const) : ("ink" as const),
    },
  ];

  /* Derived: an over-scoped member, a lapsed invite, or a lone owner. */
  const lapsed = open.find((i) => i.state === "expired");
  const lonelyOwner = owners.length === 1 && members.length > 1;
  const ada: { note: string | null; actionLabel?: string; onAct?: () => void } = lapsed
    ? {
        note: `The invite to ${lapsed.email} lapsed before they used it. Sending it again mints a fresh link — the old one stays dead.`,
        actionLabel: "Send it again",
        onAct: () => {
          void (async () => {
            const res = await resendInvite(lapsed.id);
            if (!res.ok) {
              flash(res.error);
              return;
            }
            await done("A fresh invite is on its way — it expires in seven days.");
          })();
        },
      }
    : lonelyOwner
      ? {
          note: `You are the only owner. If you lose access to this account nobody else can pay for this workspace, change its senders or close it — a second owner is the whole fix.`,
          actionLabel: "Invite someone",
          onAct: () => setDrawer({ t: "invite" }),
        }
      : { note: null };

  const peopleRows: SettingsRow[] = [
    ...members.map<SettingsRow>((m) => ({
      t: "chip",
      key: m.userId,
      n: m.name ?? m.email,
      // The address rides the row, not just the drawer: two people called Sam
      // are otherwise the same row with the same words on it.
      sub: `${m.email} · ${ROLE_WORD[m.role]} — ${ROLE_SCOPE[m.role].toLowerCase()}`,
      chip: m.role === "OWNER" ? "Owner" : ROLE_WORD[m.role],
      tone: m.role === "OWNER" ? "live" : "mute",
      onOpen: () => setDrawer({ t: "person", member: m }),
    })),
    {
      t: "chip",
      key: "ada",
      n: "Ada",
      sub: "Agent · acts inside your guardrails, and every action lands on the timeline",
      chip: "Auto",
      tone: "cyan",
    },
    ...open.map<SettingsRow>((i) => ({
      t: "chip",
      key: i.id,
      n: i.email,
      sub: inviteSub(i),
      chip: i.state === "expired" ? "Expired" : "Pending",
      tone: i.state === "expired" ? "warn" : "cyan",
      onOpen: () => setDrawer({ t: "pending", invite: i }),
    })),
  ];

  const roleRows: SettingsRow[] = (Object.keys(ROLE_SCOPE) as WorkspaceRole[]).map((r) => ({
    t: "chip",
    key: r,
    n: ROLE_WORD[r],
    sub: ROLE_SCOPE[r],
    chip: `${members.filter((m) => m.role === r).length} here`,
    tone: members.some((m) => m.role === r) ? "live" : "mute",
  }));

  return (
    <>
      <BoldItemPage
        kind="WORKSPACE"
        title="Team and roles"
        status={{ label: `${members.length} plus Ada`, tone: "live" }}
        stats={stats}
        tabs={TABS}
        tab={tab}
        onTab={setTab}
        onBack={onBack}
        onHeader={onHeader}
        ada={ada}
        recordId={data.workspaceId}
        testid="bold-wss-team-item"
      >
        {tab === 0 ? (
          <>
            {members.length === 0 ? (
              <EmptyTab testid="bold-team-none" line="Nobody here yet." />
            ) : (
              <RowList rows={peopleRows} testid="bold-team-people" />
            )}
            <AddRow label="Invite someone" testid="bold-team-invite" onClick={() => setDrawer({ t: "invite" })} />
          </>
        ) : (
          <>
            <RowList rows={roleRows} testid="bold-team-roles" />
            <TabNote>
              THESE ARE THE ROLES THIS PLATFORM ENFORCES. WHAT EACH ONE MAY DO IS CHECKED ON THE SERVER, NOT HIDDEN IN
              THE INTERFACE.
            </TabNote>
          </>
        )}
      </BoldItemPage>

      {drawer?.t === "invite" ? <InviteDrawer onDone={done} onClose={() => setDrawer(null)} /> : null}
      {drawer?.t === "person" ? (
        <PersonDrawer
          member={drawer.member}
          ownerCount={owners.length}
          onDone={done}
          onClose={() => setDrawer(null)}
        />
      ) : null}
      {drawer?.t === "pending" ? (
        <PendingInviteDrawer invite={drawer.invite} onDone={done} onClose={() => setDrawer(null)} />
      ) : null}
    </>
  );
}

/* ----------------------------------------------------------- invite drawer */

function InviteDrawer({ onDone, onClose }: { onDone: (t: string) => Promise<void>; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "AGENT" | "VIEWER">("AGENT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    setBusy(true);
    setError(null);
    const res = await sendInvite({ email: email.trim(), role });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const delivered = (res.body as { delivered?: boolean })?.delivered === true;
    await onDone(
      delivered
        ? "Invite sent — it expires in seven days."
        : "Invite created — send them the link yourself for now.",
    );
  }

  return (
    <SettingsDrawer
      label="INVITE SOMEONE"
      title="Add someone to this workspace"
      onClose={onClose}
      testid="bold-drawer-invite"
      footer={
        <>
          {step === 1 ? <PrimaryButton label="Back" tone="quiet" onClick={() => setStep(0)} /> : null}
          <span style={{ flex: 1 }} />
          <StepDots step={step} of={2} />
          {step === 0 ? (
            <PrimaryButton
              label="Next"
              testid="bold-drawer-invite-next"
              onClick={() => email.trim().includes("@") && setStep(1)}
            />
          ) : (
            <PrimaryButton
              label="Send the invite"
              busy={busy}
              testid="bold-drawer-invite-finish"
              onClick={() => void finish()}
            />
          )}
        </>
      }
    >
      {step === 0 ? (
        <>
          <StepPrompt
            prompt="Their work email."
            help="They set their own password — you never see it."
          />
          <Well
            label="EMAIL"
            value={email}
            onChange={setEmail}
            placeholder="name@brightsmile.com"
            testid="bold-drawer-invite-email"
            autoFocus
            onEnter={() => email.trim().includes("@") && setStep(1)}
          />
        </>
      ) : (
        <>
          <StepPrompt prompt="What should they be able to do?" />
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {INVITABLE.map((r) => (
              <ChoiceRow
                key={r.role}
                title={r.title}
                sub={r.sub}
                selected={role === r.role}
                onSelect={() => setRole(r.role)}
                testid={`bold-drawer-invite-role-${r.role.toLowerCase()}`}
              />
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", lineHeight: 1.6, marginTop: 14 }}>
            Owners are not invited by email — ownership is handed over from someone who already has it.
          </div>
          <DrawerError message={error} />
        </>
      )}
    </SettingsDrawer>
  );
}

/* --------------------------------------------------- a pending invite's row */

function PendingInviteDrawer({
  invite,
  onDone,
  onClose,
}: {
  invite: InviteRow;
  onDone: (t: string) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expired = invite.state === "expired";

  return (
    <SettingsDrawer
      label={expired ? "EXPIRED INVITE" : "PENDING INVITE"}
      title={invite.email}
      onClose={onClose}
      testid="bold-drawer-pendinginvite"
      footer={
        <>
          <span style={{ flex: 1 }} />
          <PrimaryButton
            label={expired ? "Send a fresh one" : "Send it again"}
            busy={busy}
            testid="bold-drawer-invite-resend"
            onClick={() => {
              void (async () => {
                setBusy(true);
                setError(null);
                const res = await resendInvite(invite.id);
                setBusy(false);
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                await onDone("Sent again — the new link expires in seven days, the old one is dead.");
              })();
            }}
          />
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        <Line label="ROLE THEY WILL GET" value={ROLE_WORD[invite.role]} />
        <Line label="INVITED BY" value={invite.invitedBy ?? "Somebody on your team"} />
        <Line
          label={expired ? "LAPSED" : "EXPIRES"}
          value={new Date(invite.expiresAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        />
        <Line label="TIMES SENT" value={String(invite.resendCount + 1)} />
        <Line
          label="DELIVERY"
          value={invite.sentAt ? "Emailed to them" : "Created here — the invite mail is not connected yet"}
        />
      </div>

      {expired ? (
        <div
          style={{
            background: "var(--cvb-amber-bg)",
            border: "1px solid var(--cvb-amber-line)",
            borderRadius: 14,
            padding: "13px 15px",
            fontSize: 12.5,
            color: "var(--cvb-amber)",
            lineHeight: 1.55,
            marginTop: 18,
          }}
        >
          The link stopped working after seven days. Nothing about their access changed — they simply never used it.
        </div>
      ) : null}

      <div style={{ marginTop: 24, borderTop: "1px solid var(--cvb-line-inner)", paddingTop: 18 }}>
        {confirm ? (
          <>
            <div style={{ fontSize: 12.5, color: "var(--cvb-danger)", lineHeight: 1.55, marginBottom: 12 }}>
              The link stops working immediately. If they are mid-signup they will be turned away.
            </div>
            <div style={{ display: "flex", gap: 9 }}>
              <PrimaryButton
                label="Revoke it"
                tone="danger"
                busy={busy}
                testid="bold-drawer-invite-revoke-confirm"
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    const res = await revokeInvite(invite.id);
                    setBusy(false);
                    if (!res.ok) {
                      setError(res.error);
                      return;
                    }
                    await onDone("Revoked — that link is dead.");
                  })();
                }}
              />
              <PrimaryButton label="Leave it" tone="quiet" onClick={() => setConfirm(false)} />
            </div>
          </>
        ) : (
          <span
            onClick={() => setConfirm(true)}
            role="button"
            data-testid="bold-drawer-invite-revoke"
            style={{ fontSize: 12.5, fontWeight: 700, color: "var(--cvb-danger)", cursor: "pointer" }}
          >
            Revoke this invite
          </span>
        )}
        <DrawerError message={error} />
      </div>
    </SettingsDrawer>
  );
}

/* ----------------------------------------------------------- person drawer */

function PersonDrawer({
  member,
  ownerCount,
  onDone,
  onClose,
}: {
  member: WorkspaceMemberRow;
  ownerCount: number;
  onDone: (t: string) => Promise<void>;
  onClose: () => void;
}) {
  const [role, setRole] = useState<WorkspaceRole>(member.role);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The server refuses either way; saying so up front is the difference
  // between a considered rule and an error message out of nowhere.
  const lastOwner = member.role === "OWNER" && ownerCount <= 1;

  return (
    <SettingsDrawer
      label="ON YOUR TEAM"
      title={member.name ?? member.email}
      onClose={onClose}
      testid="bold-drawer-person"
      footer={
        <>
          <span style={{ flex: 1 }} />
          <PrimaryButton
            label="Save the role"
            busy={busy}
            testid="bold-drawer-person-save"
            onClick={() => {
              if (role === member.role) {
                onClose();
                return;
              }
              void (async () => {
                setBusy(true);
                setError(null);
                const res = await setMemberRole(member.userId, role);
                setBusy(false);
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                await onDone(`${member.name ?? member.email} is now ${ROLE_WORD[role]}.`);
              })();
            }}
          />
        </>
      }
    >
      <div style={{ fontSize: 12.5, color: "var(--cvb-muted)", lineHeight: 1.55 }}>{member.email}</div>
      <div style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", marginTop: 6 }}>
        Joined {new Date(member.since).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
      </div>

      <div style={{ ...EYEBROW, margin: "24px 0 12px" }}>WHAT THEY MAY DO</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {(Object.keys(ROLE_SCOPE) as WorkspaceRole[]).map((r) => (
          <ChoiceRow
            key={r}
            title={ROLE_WORD[r]}
            sub={ROLE_SCOPE[r]}
            selected={role === r}
            onSelect={() => !lastOwner && setRole(r)}
            testid={`bold-drawer-person-role-${r.toLowerCase()}`}
          />
        ))}
      </div>

      {lastOwner ? (
        <div
          data-testid="bold-drawer-person-lastowner"
          style={{
            background: "var(--cvb-amber-bg)",
            border: "1px solid var(--cvb-amber-line)",
            borderRadius: 14,
            padding: "13px 15px",
            fontSize: 12.5,
            color: "var(--cvb-amber)",
            lineHeight: 1.55,
            marginTop: 16,
          }}
        >
          This is the only owner, so their role is fixed and they cannot be removed. Make someone else an owner first —
          a workspace with no owner has nobody who can pay for it or close it.
        </div>
      ) : null}

      <div style={{ marginTop: 24, borderTop: "1px solid var(--cvb-line-inner)", paddingTop: 18 }}>
        {lastOwner ? null : confirm ? (
          <>
            <div style={{ fontSize: 12.5, color: "var(--cvb-danger)", lineHeight: 1.55, marginBottom: 12 }}>
              They lose access immediately, and every conversation assigned to them goes back to the queue for someone
              else to pick up. Nothing they did is deleted.
            </div>
            <div style={{ display: "flex", gap: 9 }}>
              <PrimaryButton
                label="Remove them"
                tone="danger"
                busy={busy}
                testid="bold-drawer-person-remove-confirm"
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    const res = await removeMember(member.userId);
                    setBusy(false);
                    if (!res.ok) {
                      setError(res.error);
                      return;
                    }
                    const released = (res.body as { releasedThreads?: number })?.releasedThreads ?? 0;
                    await onDone(
                      released > 0
                        ? `Removed — ${pluralise(released, "conversation", "conversations")} went back to the queue.`
                        : "Removed.",
                    );
                  })();
                }}
              />
              <PrimaryButton label="Keep them" tone="quiet" onClick={() => setConfirm(false)} />
            </div>
          </>
        ) : (
          <span
            onClick={() => setConfirm(true)}
            role="button"
            data-testid="bold-drawer-person-remove"
            style={{ fontSize: 12.5, fontWeight: 700, color: "var(--cvb-danger)", cursor: "pointer" }}
          >
            Remove from this workspace
          </span>
        )}
        <DrawerError message={error} />
      </div>
    </SettingsDrawer>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ ...EYEBROW, fontSize: 9, letterSpacing: ".14em" }}>{label}</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: 5 }}>{value}</div>
    </div>
  );
}

