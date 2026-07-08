import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthModule } from "./auth/auth.module";
import { AuthGuard } from "./auth/auth.guard";
import { AgentsModule } from "./agents/agents.module";
import { RolesGuard } from "./auth/roles.guard";
import { DbModule } from "./db/db.module";
import { HealthController } from "./health.controller";
import { ChannelsModule } from "./channels/channels.module";
import { ContextModule } from "./context/context.module";
import { EnrollmentsModule } from "./enrollments/enrollments.module";
import { KnowledgeModule } from "./knowledge/knowledge.module";
import { MeController } from "./me/me.controller";
import { WorkspacesController } from "./workspaces/workspaces.controller";
import { PlannerModule } from "./planner/planner.module";
import { SystemModule } from "./system/system.module";
import { ContactsController } from "./contacts/contacts.controller";
import { ContactsViewController } from "./contacts/contacts-view.controller";
import { ContactFieldsController } from "./contacts/contact-fields.controller";
import { ContactListsController } from "./contacts/contact-lists.controller";
import { BusOrInlinePublisher, EVENTS_PUBLISHER } from "./events/publisher";

@Module({
  imports: [
    DbModule,
    AuthModule,
    AgentsModule,
    KnowledgeModule,
    ContextModule,
    PlannerModule,
    ChannelsModule,
    EnrollmentsModule,
    SystemModule,
  ],
  controllers: [HealthController, MeController, WorkspacesController, ContactsController, ContactsViewController, ContactFieldsController, ContactListsController],
  providers: [
    // Order matters: authenticate + resolve tenancy first, then enforce RBAC.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // C2.8: membership events (bus with Redis, inline persist without).
    { provide: EVENTS_PUBLISHER, useClass: BusOrInlinePublisher },
  ],
})
export class AppModule {}
