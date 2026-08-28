/**
 * B3c-2 (DEC-118(3)): the per-workspace recording flag, read at DIAL TIME by
 * every outbound path (endpoint dial, best-time queue fire, campaign voice
 * step, browser bridge) so the spoken recording sentence and the actual
 * capture always flip TOGETHER — a disclosure over no capture, or capture
 * with no disclosure, would each be a lie to the callee.
 */
import { withTenant, type PrismaClient } from "@clientforce/db";
import { parseWorkspaceVoiceDefaults } from "@clientforce/core";

export async function workspaceRecordingEnabled(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<boolean> {
  const workspace = await withTenant(prisma, { workspaceId }, (tx) =>
    tx.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } }),
  );
  return parseWorkspaceVoiceDefaults(workspace?.settings).recordingEnabled ?? false;
}

/** The RecordingStatusCallback target — absent PUBLIC_API_URL means the
 *  pointer callback cannot land (local rigs); recording still captures. */
export function recordingStatusCallbackUrl(): string | undefined {
  const api = (process.env.PUBLIC_API_URL ?? "").replace(/\/$/, "");
  return api ? `${api}/webhooks/twilio-voice-recording` : undefined;
}
