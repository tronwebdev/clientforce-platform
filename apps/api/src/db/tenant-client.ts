import { Inject, Injectable, Scope, UnauthorizedException } from "@nestjs/common";
import { REQUEST } from "@nestjs/core";
import { withTenant, type Prisma } from "@clientforce/db";
import type { AuthenticatedRequest } from "../auth/request-context";
import { PrismaService } from "./prisma.service";

/**
 * Request-scoped accessor that runs queries against the RLS-subject `app` client
 * inside a tenant transaction. The active workspace/agency come from the request's
 * resolved auth context, so every query is scoped by the T1 RLS policies.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantClient {
  constructor(
    @Inject(REQUEST) private readonly req: AuthenticatedRequest,
    private readonly prisma: PrismaService,
  ) {}

  get workspaceId(): string {
    return this.context.activeWorkspaceId;
  }

  private get context() {
    const auth = this.req.auth;
    if (!auth) throw new UnauthorizedException();
    return auth;
  }

  run<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const { activeWorkspaceId, activeAgencyId } = this.context;
    return withTenant(this.prisma.app, { workspaceId: activeWorkspaceId, agencyId: activeAgencyId }, fn);
  }
}
