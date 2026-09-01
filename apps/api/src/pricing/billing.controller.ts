import { Controller, Get } from "@nestjs/common";
import { CREDIT_PACKS, parseGuardrailDefaults } from "@clientforce/core";
import { Role } from "@clientforce/db";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";

/**
 * The buy flow's billing posture (B7.6, DEC-148).
 *
 * WHAT THIS IS FOR. The owner's ruling on the buy flow (REDO §1.1) is that a
 * purchase may never dead-end: either the flow can take money, or the entry
 * point is honestly disabled and says why. That decision cannot be made in the
 * browser — only the server knows whether a Stripe key exists — so this is the
 * read the surface gates on.
 *
 * KEYLESS IS THE DEFAULT, NOT AN ERROR. Stripe test keys are the owner's to
 * supply and are not present yet. That is a stated, expected state, not a
 * failure: this returns `configured: false` with the reason in plain words,
 * the surface disables Buy credits and prints that reason, and nothing
 * pretends a checkout exists. The moment `STRIPE_SECRET_KEY` is set the same
 * read flips to `configured: true` and the entry point comes alive with no
 * further code change — which is the point of building the whole path now.
 *
 * WHY NO SDK. Same posture as every other third party on this platform
 * (DEC-095, the Stripe webhook controller): raw REST and hand-rolled
 * signatures, never a vendor SDK.
 *
 * The prices come from `CREDIT_PACKS` in core, the single list the modal
 * quotes from, so a price shown to a user and a price charged to a card can
 * never disagree.
 */
@Controller("credits")
export class BillingController {
  constructor(private readonly tenant: TenantClient) {}

  @Get("billing")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async billing() {
    const secret = process.env.STRIPE_SECRET_KEY;
    const configured = typeof secret === "string" && secret.length > 0;

    /**
     * The days-of-sending line divides the pack by the workspace's OWN daily
     * ceiling — configured data the user typed on Guardrails — rather than by
     * the prototype's hard-coded 210/day, which has no basis in the workspace
     * reading it. Null when nothing is configured, so the surface drops the
     * clause instead of inventing a denominator.
     */
    const dailyCap = await this.tenant.run(async (tx) => {
      const ws = await tx.workspace.findUniqueOrThrow({
        where: { id: this.tenant.workspaceId },
        select: { settings: true },
      });
      // The workspace-wide ceiling is the guardrail DEFAULTS every campaign
      // inherits — the same source the Guardrails tab writes and the
      // workspaces controller reads. Per-agent guardrails are per-campaign
      // and are the wrong denominator for a workspace-level line.
      const defaults = parseGuardrailDefaults(
        ((ws.settings ?? {}) as { guardrailDefaults?: unknown }).guardrailDefaults,
      );
      const email = defaults.dailyCap?.email;
      return typeof email === "number" && email > 0 ? email : null;
    });

    return {
      configured,
      /**
       * Stated in the words the surface prints. It names what is missing and
       * whose job it is, because "billing unavailable" tells a practice owner
       * nothing they can act on.
       */
      reason: configured
        ? null
        : "Card payments are not connected on this platform yet, so credits cannot be bought here. Your platform contact adds them and this turns on by itself.",
      /**
       * The card on file. Always null while keyless — the buy flow shows a
       * "change card" affordance ONLY when there is a card to change, so a
       * masked PAN is never fabricated to fill the row.
       */
      card: null as { brand: string; last4: string; expMonth: number; expYear: number } | null,
      packs: CREDIT_PACKS,
      dailyCap,
    };
  }
}
