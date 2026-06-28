import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthModule } from "./auth/auth.module";
import { AuthGuard } from "./auth/auth.guard";
import { RolesGuard } from "./auth/roles.guard";
import { DbModule } from "./db/db.module";
import { HealthController } from "./health.controller";
import { MeController } from "./me/me.controller";
import { ContactsController } from "./contacts/contacts.controller";

@Module({
  imports: [DbModule, AuthModule],
  controllers: [HealthController, MeController, ContactsController],
  providers: [
    // Order matters: authenticate + resolve tenancy first, then enforce RBAC.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
