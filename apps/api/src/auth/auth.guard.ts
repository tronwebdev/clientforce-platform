import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@clientforce/db";
import { PrismaService } from "../db/prisma.service";
import { ALLOW_NO_MEMBERSHIP_KEY, IS_PUBLIC_KEY } from "./decorators";
import { mapOrgRole } from "./role-map";
import type { AuthenticatedRequest, MembershipView } from "./request-context";
import { TOKEN_VERIFIER, type TokenVerifier } from "./token-verifier";

const WORKSPACE_HEADER = "x-workspace-id";

/**
 * Global guard: verifies the bearer token and resolves the tenant context
 * (user → memberships → active workspace + agency), attaching it to the request.
 *
 * Active-workspace selection:
 *   - Clerk path (token carries `org_id`): resolve the workspace by the immutable
 *     `Workspace.clerkOrgId`. If the user has no membership there yet, provision
 *     one just-in-time (role seeded from `org_role` via AUTH_ROLE_MAP). The DB
 *     `Membership.role` is then authoritative for RBAC — `org_role` is not used
 *     per request.
 *   - Otherwise (dev/non-org tokens): the `x-workspace-id` header (must be a
 *     membership) or the first membership.
 *
 * `@Public()` routes bypass this. Tenant DB access happens later via TenantClient.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }

    let claims;
    try {
      claims = await this.verifier.verify(header.slice("Bearer ".length));
    } catch {
      throw new UnauthorizedException("Invalid token");
    }
    if (!claims.sub && !claims.email) {
      throw new UnauthorizedException("Token has no subject");
    }

    let user = await this.prisma.admin.user.findFirst({
      where: {
        OR: [
          ...(claims.sub ? [{ authProviderId: claims.sub }] : []),
          ...(claims.email ? [{ email: claims.email }] : []),
        ],
      },
    });
    // A3 (DEC-060): first login lazily upserts the User. A verified token with
    // an unknown subject creates the row (email claim REQUIRED — Clerk setup
    // adds it to the session token); a seeded user matched by email gets the
    // provider id linked. A sub/email mismatch on an already-linked user is an
    // identity conflict, never a silent takeover.
    if (!user) {
      if (!claims.sub || !claims.email) throw new UnauthorizedException("Unknown principal");
      user = await this.prisma.admin.user.create({
        data: { email: claims.email, name: claims.name ?? null, authProviderId: claims.sub },
      });
    } else if (claims.sub && user.authProviderId === null) {
      user = await this.prisma.admin.user.update({
        where: { id: user.id },
        data: { authProviderId: claims.sub },
      });
    } else if (claims.sub && user.authProviderId !== claims.sub) {
      throw new UnauthorizedException("Principal conflict");
    }

    // Clerk path: resolve workspace by org_id and provision a membership JIT.
    if (claims.orgId) {
      const workspace = await this.prisma.admin.workspace.findUnique({
        where: { clerkOrgId: claims.orgId },
        select: { id: true },
      });
      if (!workspace) throw new ForbiddenException("Organization is not provisioned");
      await this.prisma.admin.membership.upsert({
        where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
        update: {}, // existing membership wins — DB role is authoritative
        create: { userId: user.id, workspaceId: workspace.id, role: mapOrgRole(claims.orgRole) },
      });
    }

    const memberships = await this.prisma.admin.membership.findMany({
      where: { userId: user.id },
      include: { workspace: { include: { agency: true } } },
    });
    if (memberships.length === 0) {
      // A3 (DEC-060): the first-run endpoint may proceed without a membership;
      // everything else gets a TYPED 403 the web turns into the first-run modal.
      const allowNoMembership = this.reflector.getAllAndOverride<boolean>(
        ALLOW_NO_MEMBERSHIP_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (allowNoMembership) {
        req.auth = {
          user: { id: user.id, email: user.email, name: user.name },
          memberships: [],
          activeWorkspaceId: "",
          activeAgencyId: "",
          role: "VIEWER",
        };
        return true;
      }
      throw new ForbiddenException({ message: "User has no workspace membership", code: "NO_WORKSPACE" });
    }

    let active: { workspaceId: string; agencyId: string; role: Role };
    if (claims.orgId) {
      const m = memberships.find((x) => x.workspace.clerkOrgId === claims.orgId);
      if (!m) throw new ForbiddenException("Not a member of the active organization");
      active = { workspaceId: m.workspaceId, agencyId: m.workspace.agencyId, role: m.role };
    } else {
      const requested = req.headers[WORKSPACE_HEADER];
      const requestedId = Array.isArray(requested) ? requested[0] : requested;
      const m = requestedId
        ? memberships.find((x) => x.workspaceId === requestedId)
        : memberships[0];
      if (!m) throw new ForbiddenException("Not a member of the requested workspace");
      active = { workspaceId: m.workspaceId, agencyId: m.workspace.agencyId, role: m.role };
    }

    const membershipViews: MembershipView[] = memberships.map((m) => ({
      workspaceId: m.workspaceId,
      role: m.role,
      workspace: {
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
        agencyId: m.workspace.agencyId,
      },
    }));

    req.auth = {
      user: { id: user.id, email: user.email, name: user.name },
      memberships: membershipViews,
      activeWorkspaceId: active.workspaceId,
      activeAgencyId: active.agencyId,
      role: active.role,
    };
    return true;
  }
}
