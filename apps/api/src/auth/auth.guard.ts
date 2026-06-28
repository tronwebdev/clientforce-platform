import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../db/prisma.service";
import { IS_PUBLIC_KEY } from "./decorators";
import type { AuthenticatedRequest, MembershipView } from "./request-context";
import { TOKEN_VERIFIER, type TokenVerifier } from "./token-verifier";

const WORKSPACE_HEADER = "x-workspace-id";

/**
 * Global guard: verifies the bearer token and resolves the tenant context
 * (user → memberships → active workspace + agency), attaching it to the request.
 * `@Public()` routes bypass it. Tenant DB access happens later via TenantClient,
 * which sets the RLS GUCs per request from this context.
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

    const user = await this.prisma.admin.user.findFirst({
      where: {
        OR: [
          ...(claims.sub ? [{ authProviderId: claims.sub }] : []),
          ...(claims.email ? [{ email: claims.email }] : []),
        ],
      },
      include: { memberships: { include: { workspace: { include: { agency: true } } } } },
    });
    if (!user) throw new UnauthorizedException("Unknown principal");
    if (user.memberships.length === 0) {
      throw new ForbiddenException("User has no workspace membership");
    }

    const requested = req.headers[WORKSPACE_HEADER];
    const requestedId = Array.isArray(requested) ? requested[0] : requested;
    const active = requestedId
      ? user.memberships.find((m) => m.workspaceId === requestedId)
      : user.memberships[0];
    if (!active) throw new ForbiddenException("Not a member of the requested workspace");

    const memberships: MembershipView[] = user.memberships.map((m) => ({
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
      memberships,
      activeWorkspaceId: active.workspaceId,
      activeAgencyId: active.workspace.agencyId,
      role: active.role,
    };
    return true;
  }
}
