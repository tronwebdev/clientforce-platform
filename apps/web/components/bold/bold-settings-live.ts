"use client";

/**
 * Console Bold — the settings WRITE layer's client reads and writes.
 *
 * Kept beside `bold-live.ts` rather than inside it: this is one surface
 * family's traffic, and it shares that file's `get`/`send` so there is exactly
 * one proxy contract and one failure policy. Reads fail soft into honest
 * absence; writes surface the API's own message, because a swallowed write is
 * a lie told to someone who thinks they changed something.
 */
import { get, send, type BoldWriteResult } from "./bold-live";

/** The shipped membership vocabulary. Not renamed here — the enum is the enum. */
export type WorkspaceRole = "OWNER" | "ADMIN" | "AGENT" | "VIEWER";

/* ------------------------------------------------------------- core facts */

export interface WorkspaceContextField {
  key: string;
  /** The question or field name where one was written; else the registry label. */
  label: string;
  value: string;
  source: "typed" | "distilled" | "ai_decides";
  /** True for keys this surface minted — those are the editable/removable ones. */
  taught: boolean;
}

export const teachFact = (body: { question: string; answer: string; gapKey?: string }) =>
  send("workspaces/facts", "POST", body);
export const addCoreField = (body: { name: string; value: string }) =>
  send("workspaces/fields", "POST", body);
export const editFact = (body: { key: string; question?: string; answer?: string }) =>
  send("workspaces/facts", "PATCH", body);
export const forgetFact = (key: string) =>
  send(`workspaces/facts/${encodeURIComponent(key)}`, "DELETE", {});

/* ---------------------------------------------------------------- sources */

export interface WorkspaceSourceRow {
  id: string;
  kind: "WEBSITE" | "DOCUMENT" | "TEXT" | "CONNECTOR";
  label: string;
  uri: string | null;
  status: "PENDING" | "INGESTING" | "READY" | "FAILED";
  /** Facts this source produced. Null while it is still reading — not a zero. */
  chunks: number | null;
  createdAt: string;
  updatedAt: string;
}

export const fetchWorkspaceSources = () => get<WorkspaceSourceRow[]>("workspaces/sources");
export const addWebsiteSource = (uri: string, label?: string) =>
  send("knowledge/sources", "POST", { kind: "WEBSITE", uri, ...(label ? { label } : {}) });
export const addTypedSource = (label: string, text: string) =>
  send("knowledge/sources", "POST", { kind: "TEXT", label, text });
export const retrySource = (id: string) =>
  send(`knowledge/sources/${encodeURIComponent(id)}/retry`, "POST", {});
export const removeSource = (id: string) =>
  send(`knowledge/sources/${encodeURIComponent(id)}`, "DELETE", {});

/* ---------------------------------------------------------------- invites */

export interface InviteRow {
  id: string;
  email: string;
  role: WorkspaceRole;
  /** "pending" · "expired" · "accepted" · "revoked" — expiry is derived. */
  state: string;
  expiresAt: string;
  sentAt: string | null;
  resendCount: number;
  createdAt: string;
  invitedBy: string | null;
}

export const fetchInvites = () => get<InviteRow[]>("workspaces/invites");
export const sendInvite = (body: { email: string; role: "ADMIN" | "AGENT" | "VIEWER" }) =>
  send("workspaces/invites", "POST", body);
export const resendInvite = (id: string) =>
  send(`workspaces/invites/${encodeURIComponent(id)}/resend`, "POST", {});
export const revokeInvite = (id: string) =>
  send(`workspaces/invites/${encodeURIComponent(id)}/revoke`, "POST", {});

/* ---------------------------------------------------------------- members */

export const setMemberRole = (userId: string, role: WorkspaceRole) =>
  send(`workspaces/members/${encodeURIComponent(userId)}`, "PATCH", { role });
export const removeMember = (userId: string) =>
  send(`workspaces/members/${encodeURIComponent(userId)}`, "DELETE", {});

/* ---------------------------------------------------------------- numbers */

export interface NumberRequestRow {
  id: string;
  areaCode: string;
  carries: string;
  status: "REQUESTED" | "RESERVED" | "ACTIVE" | "CANCELLED";
  a2pState: string;
  senderId: string | null;
  createdAt: string;
}

export const fetchNumberRequests = () => get<NumberRequestRow[]>("workspaces/numbers");
export const requestNumber = (body: { areaCode: string; carries: "sms" | "sms_voice" }) =>
  send("workspaces/numbers", "POST", body);
export const cancelNumberRequest = (id: string) =>
  send(`workspaces/numbers/${encodeURIComponent(id)}`, "DELETE", {});

/* ---------------------------------------------------------------- senders */

/** One DNS record's posture, as the shipped checker persists it. */
export interface DnsRecordRead {
  pass: boolean;
  status: "verified" | "failed" | "unchecked";
  detail: string;
  /** The record to publish — present while it is not passing. */
  expected?: string;
  found?: string;
  lastCheckedAt: string;
}

export interface SenderHealthRead {
  senderId: string;
  fromEmail: string;
  status: string;
  windowDays: number;
  sample?: { sent: number; bounced: number; complained: number; delivered?: number };
  score?: number | null;
  state?: string | null;
  sentAllTime?: number;
  /** Same projection the list read carries — typed against its producer. */
  warmup?: {
    active: boolean;
    day: number;
    days: number;
    currentCap: number | null;
    target: number | null;
    pct: number;
    holding: boolean;
    startedAt: string;
    completedAt?: string;
  } | null;
  domainAuthStatus?: Record<string, DnsRecordRead> | null;
}

export const fetchSenderHealth = (id: string) =>
  get<SenderHealthRead>(`senders/${encodeURIComponent(id)}/health`);
export const patchSender = (id: string, body: { status?: string; dailyLimit?: number }) =>
  send(`senders/${encodeURIComponent(id)}`, "PATCH", body);
export const sendSenderTest = (body: { agentId: string; to: string }) =>
  send("senders/test-send", "POST", body);

/* ---------------------------------------------------------------- credits */

export interface CreditsGate {
  metering: { metered: string[]; unmetered: string[]; adjustmentReasons: string[] };
  history: { firstEntryAt: string | null; days: number; minDays: number; enough: boolean };
  allowance: { includedMonthly: number | null; reason: string };
}

export type { BoldWriteResult };
