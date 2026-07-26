/**
 * Agent Widget — the seam's server half (WID2, DEC-101).
 *
 * ONE endpoint serves the whole embed: `POST /widget/v1/session`. Unit 27
 * shipped the client against an honest stub; this is the real thing behind the
 * same contract (`@clientforce/core` → `widget.ts`, `contractVersion: 1`).
 *
 * Four rules are structural here, not stylistic:
 *
 * 1 · THE PUBLIC ID IS THE ONLY CREDENTIAL, AND RESOLUTION IS THE TENANCY
 *     BOUNDARY. `wgt_…` → workspace/agent is a PRE-TENANT lookup, so it uses
 *     the admin client exactly the way the auth bootstrap resolves a user →
 *     memberships. Everything after that runs through `withTenant` on the
 *     RLS-subject app client — a visitor's request ends up as tenant-scoped as
 *     an authenticated one, and no tenant id ever travels back to the page.
 * 2 · THE SERVER OFFERS ONLY FLOWS IT CAN ACTUALLY SERVE. A workspace can
 *     enable all six in setup, but a flow whose server half does not exist yet
 *     is not advertised and is refused if a stale client asks for it. That is
 *     the honest-absence rule in config form: no placeholder chips, no fake
 *     dialling, no "Booked · Tue 10:30" without a booking.
 * 3 · ATTRIBUTION IS A PLAN CHECK, NEVER A TOGGLE. `platformAttribution` is
 *     computed from the OWNING AGENCY's plan tier — deliberately not from
 *     `FeatureFlag`, which is workspace-scoped and would hand a workspace user
 *     the switch canon §7 forbids them. Unknown plan ⇒ attribution SHOWN: the
 *     failure mode has to be "Clientforce is credited", never "silently
 *     white-labelled".
 * 4 · A PUBLIC AI ENDPOINT IS AN ABUSE SURFACE. Every agent turn costs the
 *     tenant credits, so the caps below are load-bearing, not decoration.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  WIDGET_CONTRACT_VERSION,
  WIDGET_QUICK_ACTION_FLOW,
  WIDGET_REFUSALS,
  type WidgetFlow,
  type WidgetFlows,
  type WidgetMessage,
  type WidgetQuickAction,
  type WidgetQuickActionKind,
  type WidgetSessionRequest,
  type WidgetSessionResponse,
} from "@clientforce/core";
import { assertChannelLive, assertTenantActive } from "@clientforce/channels";
import { withTenant, type Prisma } from "@clientforce/db";
import { PrismaService } from "../db/prisma.service";
import { EVENTS_PUBLISHER, type EventsPublisher } from "../events/publisher";
import { WIDGET_ANSWERER, type WidgetAnswerer } from "./widget.providers";

/**
 * Flows whose SERVER HALF exists. The workspace's own toggles are intersected
 * with this: enabling "Book a visit" in setup does nothing until the wave that
 * builds slot availability lands, because advertising a chip that cannot
 * complete is the invented surface the repo forbids.
 *
 * W1 ships `askQuestion` — the one flow that needs no third-party provider.
 * The capture flows (call me back · schedule callback · estimate) and booking
 * arrive with their waves; live voice waits on a transport (Q-057).
 */
export const IMPLEMENTED_FLOWS: readonly WidgetFlow[] = ["askQuestion"];

/** Per-session cap on billable agent turns. A visitor conversation that needs
 *  more than this is not a conversation any more. */
export const MAX_AGENT_TURNS_PER_SESSION = 40;

/** Per-widget cap on new sessions in a rolling UTC day — the crude brake that
 *  stops one embedded page from burning a tenant's credits overnight. */
export const MAX_SESSIONS_PER_WIDGET_PER_DAY = 500;

export class WidgetRefusal extends Error {
  constructor(
    readonly code: keyof typeof WIDGET_REFUSALS,
    readonly status: number,
  ) {
    super(WIDGET_REFUSALS[code]);
    this.name = "WidgetRefusal";
  }
}

interface ResolvedWidget {
  id: string;
  workspaceId: string;
  agentId: string;
  flows: WidgetFlows;
  allowedOrigins: string[];
  design: Record<string, unknown>;
}

const DEFAULT_FLOWS: WidgetFlows = {
  bookVisit: true,
  callMeBack: true,
  scheduleCallback: true,
  estimate: true,
  liveVoice: true,
  askQuestion: true,
};

/** Server-offered chip labels. Tenants override per widget; the client draws
 *  the icon from the KIND, so a label can never smuggle an emoji back in. */
const DEFAULT_LABELS: Record<WidgetQuickActionKind, string> = {
  book_visit: "Book a visit",
  call_me_back: "Call me back",
  schedule_callback: "Schedule a callback",
  estimate: "Get an estimate",
  ask_question: "Ask a question",
};

const nowIso = (): string => new Date().toISOString();

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

@Injectable()
export class WidgetService {
  private readonly logger = new Logger(WidgetService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WIDGET_ANSWERER) private readonly answerer: WidgetAnswerer,
    @Inject(EVENTS_PUBLISHER) private readonly publisher: EventsPublisher,
  ) {}

  async handle(req: WidgetSessionRequest, originHeader?: string): Promise<WidgetSessionResponse> {
    const widget = await this.resolve(req.widgetId);
    this.assertOriginAllowed(widget, originHeader);

    const servable = this.servableFlows(widget.flows);
    const attribution = await this.platformAttribution(widget.workspaceId);

    return withTenant(this.prisma.app, { workspaceId: widget.workspaceId }, async (tx) => {
      const session = await this.loadOrCreateSession(tx, widget, req, originHeader);
      const turns = this.readTurns(session.turns);
      const appended: WidgetMessage[] = [];

      switch (req.event.type) {
        case "boot":
          // The greeting is the widget's own copy (client-side default or the
          // tenant's override) — the server does not compose it, so booting
          // costs nothing and cannot fail on a missing model key.
          break;
        case "open":
        case "close":
          await tx.widgetSession.update({
            where: { id: session.id },
            data: {
              lastEventAt: new Date(),
              ...(req.event.type === "close" ? { status: "closed", closedAt: new Date() } : {}),
            },
          });
          break;
        case "visitor_message": {
          const visitorTurn = this.turn("visitor", req.event.text);
          appended.push(visitorTurn);
          const reply = await this.answer(widget, session, [...turns, visitorTurn], req.event.text);
          appended.push(reply);
          break;
        }
        case "quick_action": {
          const flow = WIDGET_QUICK_ACTION_FLOW[req.event.action];
          if (!servable.includes(flow)) throw new WidgetRefusal("FLOW_DISABLED", 422);
          const asked = this.turn("visitor", DEFAULT_LABELS[req.event.action]);
          appended.push(asked);
          appended.push(
            await this.answer(widget, session, [...turns, asked], DEFAULT_LABELS[req.event.action]),
          );
          break;
        }
        case "capture_submit":
          // Nothing collects fields until the capture flows land; accepting a
          // bag of PII with nowhere to put it would be worse than refusing.
          throw new WidgetRefusal("FLOW_DISABLED", 422);
      }

      if (appended.length) {
        await tx.widgetSession.update({
          where: { id: session.id },
          data: {
            turns: [...turns, ...appended] as unknown as Prisma.InputJsonValue,
            agentTurns: { increment: appended.filter((m) => m.role === "agent").length },
            lastEventAt: new Date(),
          },
        });
      }

      return {
        contractVersion: WIDGET_CONTRACT_VERSION,
        sessionId: session.id,
        agent: {
          name: (asRecord(widget.design).agentName as string) ?? "Ada",
          subtitle: (asRecord(widget.design).subtitle as string) ?? "AI Assistant",
          state: "idle",
        },
        messages: appended,
        // Chips are offered on boot only. An ABSENT field means "unchanged" —
        // sending [] mid-conversation would clear the client's chips, so the
        // other events deliberately omit it.
        ...(req.event.type === "boot" ? { quickActions: this.chips(servable) } : {}),
        appearance: null,
        branding: { platformAttribution: attribution },
        meta: { stub: false },
      };
    });
  }

  /**
   * `wgt_…` → workspace/agent. PRE-TENANT by necessity (there is no workspace
   * context until this resolves), so it uses the admin client the same way the
   * auth bootstrap does — and it selects only what the rail needs.
   */
  private async resolve(publicId: string): Promise<ResolvedWidget> {
    const row = await this.prisma.admin.widget.findUnique({
      where: { publicId },
      select: {
        id: true,
        workspaceId: true,
        agentId: true,
        flows: true,
        allowedOrigins: true,
        design: true,
      },
    });
    if (!row) throw new WidgetRefusal("UNKNOWN_WIDGET", 404);
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      agentId: row.agentId,
      flows: { ...DEFAULT_FLOWS, ...(asRecord(row.flows) as Partial<WidgetFlows>) },
      allowedOrigins: row.allowedOrigins,
      design: asRecord(row.design),
    };
  }

  /** Empty allow-list ⇒ any origin: the honest default for a script whose whole
   *  job is to run on a page we do not control. A tenant that sets one gets it
   *  enforced. */
  private assertOriginAllowed(widget: ResolvedWidget, origin?: string): void {
    if (widget.allowedOrigins.length === 0) return;
    const host = this.hostOf(origin);
    if (!host || !widget.allowedOrigins.some((a) => this.hostOf(a) === host)) {
      throw new WidgetRefusal("ORIGIN_NOT_ALLOWED", 403);
    }
  }

  private hostOf(value?: string): string | null {
    if (!value) return null;
    try {
      return new URL(value.includes("://") ? value : `https://${value}`).host.toLowerCase();
    } catch {
      return null;
    }
  }

  private servableFlows(configured: WidgetFlows): WidgetFlow[] {
    return IMPLEMENTED_FLOWS.filter((flow) => configured[flow]);
  }

  private chips(servable: WidgetFlow[]): WidgetQuickAction[] {
    return (Object.keys(WIDGET_QUICK_ACTION_FLOW) as WidgetQuickActionKind[])
      .filter((kind) => servable.includes(WIDGET_QUICK_ACTION_FLOW[kind]))
      .map((kind) => ({ kind, label: DEFAULT_LABELS[kind] }));
  }

  /**
   * The plan check (rule 3). Agency tier → that tier's Plan row → its
   * `features.whiteLabel`. Anything unresolved shows the line.
   */
  private async platformAttribution(workspaceId: string): Promise<boolean> {
    const workspace = await this.prisma.admin.workspace.findUnique({
      where: { id: workspaceId },
      select: { agency: { select: { id: true, planTier: true } } },
    });
    if (!workspace?.agency) return true;
    const plan = await this.prisma.admin.plan.findFirst({
      where: { agencyId: workspace.agency.id, name: workspace.agency.planTier },
      select: { features: true },
    });
    return asRecord(plan?.features).whiteLabel !== true;
  }

  private async loadOrCreateSession(
    tx: Prisma.TransactionClient,
    widget: ResolvedWidget,
    req: WidgetSessionRequest,
    origin?: string,
  ): Promise<{ id: string; turns: unknown; agentTurns: number }> {
    if (req.sessionId) {
      const existing = await tx.widgetSession.findFirst({
        where: { id: req.sessionId, widgetId: widget.id },
        select: { id: true, turns: true, agentTurns: true },
      });
      // An unknown/foreign session id is not an error the visitor can fix —
      // start a fresh one rather than leaking that the id belongs elsewhere.
      if (existing) {
        if (existing.agentTurns >= MAX_AGENT_TURNS_PER_SESSION) {
          throw new WidgetRefusal("RATE_LIMITED", 429);
        }
        return existing;
      }
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const today = await tx.widgetSession.count({
      where: { widgetId: widget.id, startedAt: { gte: since } },
    });
    if (today >= MAX_SESSIONS_PER_WIDGET_PER_DAY) throw new WidgetRefusal("RATE_LIMITED", 429);

    const created = await tx.widgetSession.create({
      data: {
        workspaceId: widget.workspaceId,
        widgetId: widget.id,
        agentId: widget.agentId,
        pageUrl: req.context?.pageUrl ?? null,
        referrer: req.context?.referrer ?? null,
        locale: req.context?.locale ?? null,
        originHost: this.hostOf(origin),
      },
      select: { id: true, turns: true, agentTurns: true },
    });

    // `widget.conversation_started.v1` has been in the catalog since the data
    // model was authored with NOTHING producing it. This is that producer —
    // and it is what lights up the `widget_chat_started` automation trigger
    // (Q-035's widget half). One firing per session, never per event: a
    // visitor who opens, closes and reopens the panel is one conversation.
    //
    // Publishing is best-effort ON PURPOSE. The bus is not on the visitor's
    // critical path — a Redis blip must not turn a working chat into a 500 on
    // a customer's marketing page.
    void this.publisher
      .publish({
        workspaceId: widget.workspaceId,
        type: "widget.conversation_started.v1",
        payload: { widgetId: widget.id },
      })
      .catch((err: unknown) => this.logger.warn(`widget event publish failed: ${String(err)}`));

    return created;
  }

  private readTurns(value: unknown): WidgetMessage[] {
    return Array.isArray(value) ? (value as WidgetMessage[]) : [];
  }

  private turn(role: "agent" | "visitor", text: string): WidgetMessage {
    return {
      id: `wm_${Math.random().toString(36).slice(2, 12)}`,
      role,
      text,
      at: nowIso(),
    };
  }

  /**
   * The grounded answer. Retrieval + composition live behind `WidgetAnswerer`
   * so the API process can be honest about what it has: with no model provider
   * configured, this refuses rather than inventing a reply.
   */
  private async answer(
    widget: ResolvedWidget,
    session: { id: string },
    history: WidgetMessage[],
    question: string,
  ): Promise<WidgetMessage> {
    try {
      // The send boundary, ported not forked (the standing rail): a suspended
      // tenant or a killed "widget" channel stops the agent talking to the
      // public. This call is what puts "widget" in KILL_SWITCH_CHANNELS —
      // offering a switch whose boundary never checks it would ship a silent
      // no-op (Q-025's ruling).
      await assertTenantActive(this.prisma.app, widget.workspaceId);
      await assertChannelLive(this.prisma.app, widget.workspaceId, "widget");

      const text = await this.answerer.answer({
        workspaceId: widget.workspaceId,
        agentId: widget.agentId,
        sessionId: session.id,
        question,
        history,
      });
      return this.turn("agent", text);
    } catch (err) {
      this.logger.warn(`widget answer failed for ${widget.id}: ${String(err)}`);
      throw new WidgetRefusal("AGENT_UNAVAILABLE", 503);
    }
  }
}
