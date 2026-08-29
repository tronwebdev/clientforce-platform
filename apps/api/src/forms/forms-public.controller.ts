/**
 * B5 (DEC-130): the form spine's PUBLIC rail — the hosted page's two
 * endpoints, modeled on the widget's stance: deliberately unauthenticated
 * (a form exists to be filled in by strangers), protected by shape rather
 * than secret — the `frm_…` id resolves server-side, the SERVER-owned spec
 * validates every answer, a per-form hourly cap brakes abuse, and refusal
 * copy is written for a visitor (never names a tenant or whether one exists).
 *
 * The submit is the completeCapture pattern end-to-end: dedupe the contact
 * (email first, then phone), source "form", tag from routing, the
 * FormSubmission row, the idempotent enrollment (the zapier-enroll shape,
 * meta.source "form"), and `form.submitted.v1` published AFTER commit and
 * AWAITED — a lost submit event means silent automations for a real lead.
 * That one event is what lights the automations `lead_captured` trigger.
 */
import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
} from "@nestjs/common";
import { formSubmitSchema, type FormField } from "@clientforce/core";
import { withTenant, type Prisma } from "@clientforce/db";
import { EVENT_TYPES } from "@clientforce/events";
import { Public } from "../auth/decorators";
import { PrismaService } from "../db/prisma.service";
import { EVENTS_PUBLISHER, type EventsPublisher } from "../events/publisher";

const HOURLY_CAP = 120;
const GONE = "This form isn't taking responses right now.";

@Controller("forms/v1")
export class FormsPublicController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENTS_PUBLISHER) private readonly publisher: EventsPublisher,
  ) {}

  private async resolve(publicId: string) {
    const form = await this.prisma.admin.form.findUnique({ where: { publicId } });
    if (!form || form.status !== "live") throw new NotFoundException(GONE);
    return form;
  }

  /** What the hosted page renders — the server-owned spec, nothing more. */
  @Public()
  @Get(":publicId")
  async spec(@Param("publicId") publicId: string) {
    const form = await this.resolve(publicId);
    const design = (form.design ?? {}) as { intro?: string; submitLabel?: string };
    return {
      title: form.title,
      intro: design.intro ?? null,
      submitLabel: design.submitLabel ?? "Send",
      fields: (form.fields ?? []) as FormField[],
    };
  }

  @Public()
  @Post(":publicId/submit")
  async submit(@Param("publicId") publicId: string, @Body() body: unknown) {
    const parsed = formSubmitSchema.safeParse(body);
    if (!parsed.success) throw new UnprocessableEntityException("That didn't look right — reload and try again.");
    const form = await this.resolve(publicId);
    const fields = (form.fields ?? []) as FormField[];
    const answers = parsed.data.answers;

    // The SERVER's spec is the law: required fields present, choice answers
    // from the offered options, nothing outside the declared keys.
    for (const key of Object.keys(answers)) {
      if (!fields.some((f) => f.key === key)) delete answers[key];
    }
    for (const f of fields) {
      const v = (answers[f.key] ?? "").trim();
      if (f.required && !v) {
        throw new UnprocessableEntityException(`"${f.label}" is needed.`);
      }
      if (v && f.type === "choice" && f.options && !f.options.includes(v)) {
        throw new UnprocessableEntityException(`Pick one of the offered options for "${f.label}".`);
      }
    }

    const workspaceId = form.workspaceId;
    const routing = (form.routing ?? {}) as { campaignId?: string | null; tag?: string };
    const email = fields.find((f) => f.type === "email");
    const phone = fields.find((f) => f.type === "phone");
    const nameField = fields.find((f) => f.type === "text");
    const emailVal = email ? (answers[email.key] ?? "").trim() : "";
    const phoneVal = phone ? (answers[phone.key] ?? "").trim() : "";
    const nameVal = nameField ? (answers[nameField.key] ?? "").trim() : "";
    const [firstName, ...rest] = nameVal.split(/\s+/).filter(Boolean);
    const lastName = rest.join(" ");

    const result = await withTenant(this.prisma.app, { workspaceId }, async (tx) => {
      // The storm brake, not a spend meter.
      const lastHour = await tx.formSubmission.count({
        where: { formId: form.id, submittedAt: { gte: new Date(Date.now() - 3600_000) } },
      });
      if (lastHour >= HOURLY_CAP) {
        throw new HttpException("This form is very busy — try again in a little while.", 429);
      }

      const existing =
        (emailVal
          ? await tx.contact.findFirst({ where: { workspaceId, email: emailVal } })
          : null) ??
        (phoneVal ? await tx.contact.findFirst({ where: { workspaceId, phone: phoneVal } }) : null);
      const tag = routing.tag?.trim();
      const contact = existing
        ? tag && !existing.tags.includes(tag)
          ? await tx.contact.update({
              where: { id: existing.id },
              data: { tags: [...existing.tags, tag] },
            })
          : existing
        : await tx.contact.create({
            data: {
              workspaceId,
              source: "form",
              optOut: {},
              tags: tag ? [tag] : [],
              ...(emailVal ? { email: emailVal } : {}),
              ...(phoneVal ? { phone: phoneVal } : {}),
              ...(firstName ? { firstName } : {}),
              ...(lastName ? { lastName } : {}),
            },
          });

      await tx.formSubmission.create({
        data: {
          workspaceId,
          formId: form.id,
          contactId: contact.id,
          answers: answers as Prisma.InputJsonValue,
        },
      });

      // Idempotent enrollment — the zapier-enroll shape, form provenance.
      let routedTo: string | undefined;
      if (routing.campaignId) {
        const campaign = await tx.campaign.findFirst({
          where: { workspaceId, id: routing.campaignId },
          select: { id: true },
        });
        if (campaign) {
          const held = await tx.enrollment.findFirst({
            where: { workspaceId, campaignId: campaign.id, contactId: contact.id },
            select: { id: true },
          });
          if (!held) {
            await tx.enrollment.create({
              data: {
                workspaceId,
                campaignId: campaign.id,
                contactId: contact.id,
                workflowId: `form-${contact.id}-${campaign.id}`,
                pipelineStage: "new",
                meta: { source: "form", formId: form.id },
              },
            });
          }
          routedTo = campaign.id;
        }
      }
      return { contactId: contact.id, routedTo };
    });

    // After commit, AWAITED — the join point automations listen on.
    await this.publisher.publish({
      type: EVENT_TYPES.FORM_SUBMITTED,
      workspaceId,
      contactId: result.contactId,
      ...(result.routedTo ? { campaignId: result.routedTo } : {}),
      payload: {
        formId: form.id,
        fields: answers,
        ...(result.routedTo ? { routedTo: result.routedTo } : {}),
      },
    });

    const redirectUrl = ((form.routing ?? {}) as { redirectUrl?: string }).redirectUrl ?? null;
    return { ok: true, redirectUrl };
  }
}
