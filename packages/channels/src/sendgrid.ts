import { randomUUID } from "node:crypto";
import type { SenderConnection } from "@clientforce/db";
import type { EmailSender, RenderedEmail } from "./types";

/**
 * CF_MANAGED (shared pool) — SendGrid v3 via fetch, platform key from Key
 * Vault (`SENDGRID-API-KEY`). SANDBOX MODE by default until P1.8 (issue
 * P1.5): SendGrid validates and accepts the payload but delivers nothing;
 * `CHANNELS_SANDBOX=false` turns real delivery on, deliberately.
 */
export class SendGridSender implements EmailSender {
  constructor(
    private readonly apiKey = process.env.SENDGRID_API_KEY,
    private readonly sandbox = process.env.CHANNELS_SANDBOX !== "false",
    private readonly baseUrl = process.env.SENDGRID_BASE_URL ?? "https://api.sendgrid.com",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(
    email: RenderedEmail,
    _sender: SenderConnection,
  ): Promise<{ providerMessageId: string }> {
    if (!this.apiKey) {
      throw new Error(
        "SENDGRID_API_KEY is not set. In deployed environments it resolves from Key Vault secret SENDGRID-API-KEY.",
      );
    }
    // Stable provider id we control: SendGrid echoes X-Message-Id, but sandbox
    // responses carry no id — so we mint the RFC Message-ID ourselves and pass
    // it through; threading (owner rule 3) then works identically in sandbox.
    const messageId = `<${randomUUID()}@send.clientforce.io>`;
    const headers: Record<string, string> = { "Message-ID": messageId, ...email.headers };
    if (email.inReplyTo) headers["In-Reply-To"] = email.inReplyTo;
    if (email.references?.length) headers.References = email.references.join(" ");

    const res = await this.fetchImpl(`${this.baseUrl}/v3/mail/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: email.to }] }],
        from: { email: email.fromEmail, name: email.fromName },
        ...(email.replyTo ? { reply_to: { email: email.replyTo } } : {}),
        subject: email.subject,
        content: [{ type: "text/plain", value: email.body }],
        headers,
        mail_settings: { sandbox_mode: { enable: this.sandbox } },
      }),
    });
    if (!(res.status === 200 || res.status === 202)) {
      const detail = await res.text().catch(() => "");
      throw new Error(`SendGrid send failed: HTTP ${res.status} ${detail.slice(0, 300)}`);
    }
    return { providerMessageId: res.headers.get("x-message-id") ?? messageId };
  }
}

/** Designed-but-inert tiers — same interface, explicit not-yet (issue P1.5). */
export class NotImplementedSender implements EmailSender {
  constructor(private readonly tier: string) {}
  async send(): Promise<{ providerMessageId: string }> {
    throw new Error(
      `${this.tier} sending is designed but not yet implemented (P1.5 ships CF_MANAGED)`,
    );
  }
}
