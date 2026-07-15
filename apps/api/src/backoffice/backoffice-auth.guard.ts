import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { BackofficeDb } from "./backoffice-db.service";
import type { BackofficeRequest } from "./request";
import { verifyStaffToken } from "./staff-token";

/**
 * Governs every `/backoffice` route except the public login. TWO independent
 * gates, so a tenant can never reach the operator surface:
 *
 *   1. A valid STAFF token — distinct audience/issuer `clientforce-backoffice`.
 *      A tenant dev-JWT (audience `clientforce`) fails verification outright.
 *   2. The token's email must be an ACTIVE row in the owner-managed
 *      `PlatformStaff` allow-list — a table no tenant credential is ever in,
 *      and which the RLS-subject tenant role cannot even read.
 *
 * This guard is applied per-controller (`@UseGuards`), NOT globally, and the
 * backoffice controllers are `@Public()` so the global tenant AuthGuard/RolesGuard
 * never touch them.
 */
@Injectable()
export class BackofficeAuthGuard implements CanActivate {
  constructor(private readonly db: BackofficeDb) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<BackofficeRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing staff bearer token");
    }

    let claims;
    try {
      claims = await verifyStaffToken(header.slice("Bearer ".length));
    } catch {
      throw new UnauthorizedException("Invalid staff token");
    }

    const staff = await this.db.client.platformStaff.findUnique({
      where: { email: claims.email },
    });
    if (!staff) throw new ForbiddenException("Not a platform operator");
    if (staff.status !== "ACTIVE") throw new ForbiddenException("Platform operator is disabled");

    req.staff = { id: staff.id, email: staff.email, name: staff.name, role: staff.role };
    return true;
  }
}
