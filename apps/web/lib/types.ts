export type Role = "OWNER" | "ADMIN" | "AGENT" | "VIEWER";

export interface WorkspaceView {
  id: string;
  name: string;
  slug: string;
  agencyId: string;
}

export interface MembershipView {
  workspaceId: string;
  role: Role;
  workspace: WorkspaceView;
}

/** Shape returned by the API's GET /me. */
export interface Me {
  user: { id: string; email: string; name: string | null };
  memberships: MembershipView[];
  activeWorkspace: WorkspaceView | null;
  activeAgencyId: string;
  role: Role;
}

export interface Contact {
  id: string;
  workspaceId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  createdAt: string;
}

/** R1-UI (DEC-088): one account-rule row from GET /automations — the stored
 *  Json parsed through the core unions server-side; `invalid` = an
 *  unparseable row rendering as an HONEST error state (the B6 stance). */
export interface AutomationListRow {
  id: string;
  name: string;
  enabled: boolean;
  trigger: import("@clientforce/core").CampaignRuleTrigger | null;
  conditions: import("@clientforce/core").CampaignRuleCondition[];
  actions: import("@clientforce/core").CampaignRuleAction[];
  invalid: boolean;
  runs: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** R1-UI (DEC-088): one run-history row from GET /automations/:id/runs —
 *  ledger-sourced (`automation.rule.run.v1` Event rows), newest first. */
export interface AutomationRunRow {
  id: string;
  runId: string | null;
  status: string;
  trigger: string | null;
  detail: string | null;
  contactId: string | null;
  contactLabel: string | null;
  campaignId: string | null;
  occurredAt: string;
}
