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
import { PlannerModule } from "./planner/planner.module";
import { ContactsController } from "./contacts/contacts.controller";

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
  ],
  controllers: [HealthController, MeController, ContactsController],
  providers: [
    // Order matters: authenticate + resolve tenancy first, then enforce RBAC.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
