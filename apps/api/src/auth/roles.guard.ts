import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@clientforce/db";
import { ROLES_KEY } from "./decorators";
import type { AuthenticatedRequest } from "./request-context";

/**
 * RBAC guard (runs after AuthGuard). Routes with no `@Roles(...)` are allowed for
 * any authenticated member; otherwise the active membership role must be listed.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.auth) throw new UnauthorizedException();
    if (!required.includes(req.auth.role)) {
      throw new ForbiddenException("Insufficient role");
    }
    return true;
  }
}
