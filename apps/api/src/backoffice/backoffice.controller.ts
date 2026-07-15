import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  auditQuerySchema,
  backofficeLoginSchema,
  backofficeReasonSchema,
  creditAdjustmentSchema,
  tenantListQuerySchema,
} from "@clientforce/core";
import type { ZodSchema } from "zod";
import { Public } from "../auth/decorators";
import { BackofficeAuthGuard } from "./backoffice-auth.guard";
import { BackofficeDb } from "./backoffice-db.service";
import { BackofficeService } from "./backoffice.service";
import type { BackofficeRequest } from "./request";
import { signStaffToken } from "./staff-token";

function parse<T>(schema: ZodSchema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      message: "Validation failed",
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}

/**
 * Platform-staff login — the only OPEN backoffice route. `@Public()` skips the
 * global tenant AuthGuard; there is no staff guard here because this IS the
 * point where a staff token is minted. It succeeds only for an ACTIVE row in the
 * owner-managed allow-list, so a tenant email gets nothing.
 */
@Public()
@Controller("backoffice")
export class BackofficeSessionController {
  constructor(private readonly db: BackofficeDb) {}

  @Post("session")
  async login(@Body() body: unknown) {
    const { email } = parse(backofficeLoginSchema, body);
    const staff = await this.db.client.platformStaff.findUnique({ where: { email } });
    if (!staff || staff.status !== "ACTIVE") {
      throw new UnauthorizedException("Not an active platform operator");
    }
    const token = await signStaffToken({
      sub: staff.id,
      email: staff.email,
      ...(staff.name ? { name: staff.name } : {}),
      role: staff.role,
    });
    return {
      token,
      staff: { id: staff.id, email: staff.email, name: staff.name, role: staff.role },
    };
  }
}

/**
 * The guarded backoffice surface. `@Public()` keeps the global tenant guards off;
 * `BackofficeAuthGuard` then fully governs access (staff token + allow-list).
 */
@Public()
@UseGuards(BackofficeAuthGuard)
@Controller("backoffice")
export class BackofficeController {
  constructor(private readonly svc: BackofficeService) {}

  @Get("me")
  me(@Req() req: BackofficeRequest) {
    return req.staff;
  }

  @Get("agencies")
  agencies(@Query("q") q?: string, @Query("status") status?: string) {
    const filter = parse(tenantListQuerySchema, {
      ...(q ? { q } : {}),
      ...(status ? { status } : {}),
    });
    return this.svc.listAgencies(filter);
  }

  @Post("agencies/:id/suspend")
  suspendAgency(@Param("id") id: string, @Body() body: unknown, @Req() req: BackofficeRequest) {
    const { reason } = parse(backofficeReasonSchema, body);
    return this.svc.setAgencyStatus(req.staff!, id, "SUSPENDED", reason);
  }

  @Post("agencies/:id/reactivate")
  reactivateAgency(@Param("id") id: string, @Body() body: unknown, @Req() req: BackofficeRequest) {
    const { reason } = parse(backofficeReasonSchema, body);
    return this.svc.setAgencyStatus(req.staff!, id, "ACTIVE", reason);
  }

  @Post("workspaces/:id/suspend")
  suspendWorkspace(@Param("id") id: string, @Body() body: unknown, @Req() req: BackofficeRequest) {
    const { reason } = parse(backofficeReasonSchema, body);
    return this.svc.setWorkspaceStatus(req.staff!, id, "SUSPENDED", reason);
  }

  @Post("workspaces/:id/reactivate")
  reactivateWorkspace(@Param("id") id: string, @Body() body: unknown, @Req() req: BackofficeRequest) {
    const { reason } = parse(backofficeReasonSchema, body);
    return this.svc.setWorkspaceStatus(req.staff!, id, "ACTIVE", reason);
  }

  @Post("workspaces/:id/credit-adjustments")
  adjustCredit(@Param("id") id: string, @Body() body: unknown, @Req() req: BackofficeRequest) {
    const dto = parse(creditAdjustmentSchema, body);
    return this.svc.adjustCredit(req.staff!, id, dto.delta, dto.reason);
  }

  @Get("workspaces/:id/credit-ledger")
  ledger(@Param("id") id: string) {
    return this.svc.recentLedger(id);
  }

  @Get("audit-log")
  audit(@Query("targetType") targetType?: string, @Query("targetId") targetId?: string) {
    const filter = parse(auditQuerySchema, {
      ...(targetType ? { targetType } : {}),
      ...(targetId ? { targetId } : {}),
    });
    return this.svc.listAudit(filter);
  }
}
