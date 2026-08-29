import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthModule } from "./auth/auth.module";
import { AuthGuard } from "./auth/auth.guard";
import { AgentsModule } from "./agents/agents.module";
import { AutomationsModule } from "./automations/automations.module";
import { IntegrationsModule } from "./integrations/integrations.module";
import { ZapierModule } from "./zapier/zapier.module";
import { RolesGuard } from "./auth/roles.guard";
import { DbModule } from "./db/db.module";
import { HealthController } from "./health.controller";
import { ChannelsModule } from "./channels/channels.module";
import { ContextModule } from "./context/context.module";
import { EnrollmentsModule } from "./enrollments/enrollments.module";
import { BackofficeModule } from "./backoffice/backoffice.module";
import { KnowledgeModule } from "./knowledge/knowledge.module";
import { MeController } from "./me/me.controller";
import { WorkspacesController } from "./workspaces/workspaces.controller";
import { PlannerModule } from "./planner/planner.module";
import { SystemModule } from "./system/system.module";
import { ApprovalsModule } from "./approvals/approvals.module";
import { VoiceModule } from "./voice/voice.module";
import { WidgetModule } from "./widget/widget.module";
import { FormsModule } from "./forms/forms.module";
import { ProposalsModule } from "./proposals/proposals.module";
import { LeadsModule } from "./leads/leads.module";
import { ContactsController } from "./contacts/contacts.controller";
import { ContactsViewController } from "./contacts/contacts-view.controller";
import { ContactFieldsController } from "./contacts/contact-fields.controller";
import { ContactListsController } from "./contacts/contact-lists.controller";
import { ContactValidationController } from "./contacts/contact-validation.controller";
import { FlagsController } from "./flags/flags.controller";
import { MeNeedsController } from "./me/needs.controller";
import { CreditPricesController } from "./pricing/credit-prices.controller";
import { CreditsController } from "./pricing/credits.controller";
import { SuggestionsController } from "./suggestions/suggestions.controller";
import { validationProviders } from "./contacts/validation.providers";
import { BusOrInlinePublisher, EVENTS_PUBLISHER } from "./events/publisher";

@Module({
  imports: [
    DbModule,
    AuthModule,
    AgentsModule,
    AutomationsModule,
    IntegrationsModule,
    ZapierModule,
    KnowledgeModule,
    ContextModule,
    PlannerModule,
    ChannelsModule,
    EnrollmentsModule,
    BackofficeModule,
    SystemModule,
    ApprovalsModule,
    VoiceModule,
    WidgetModule,
    FormsModule,
    ProposalsModule,
    LeadsModule,
  ],
  controllers: [
    HealthController,
    MeController,
    WorkspacesController,
    ContactsController,
    ContactsViewController,
    ContactFieldsController,
    ContactListsController,
    ContactValidationController,
    // B0 (Console Bold): tenant read of the app-readable FeatureFlag table.
    FlagsController,
    // B1 (DEC-104): cross-workspace replies-waiting read (rail needs pill).
    MeNeedsController,
    // B2 (DEC-106): tenant read of resolved credit prices (D1 — prices are data).
    CreditPricesController,
    // B7 (DEC-133): tenant credit SPEND view over the real ledger (Q-108 honest).
    CreditsController,
    // B2.6 (DEC-110): the deterministic suggestion sweep (drafts via the one create path).
    SuggestionsController,
  ],
  providers: [
    // Order matters: authenticate + resolve tenancy first, then enforce RBAC.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // C2.8: membership events (bus with Redis, inline persist without).
    { provide: EVENTS_PUBLISHER, useClass: BusOrInlinePublisher },
    // LH1 (DEC-087): validation queue + light-pass MX seam (tests override).
    ...validationProviders,
  ],
})
export class AppModule {}
