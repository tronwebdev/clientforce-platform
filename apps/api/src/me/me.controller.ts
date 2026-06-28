import { Controller, Get, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/request-context";

@Controller("me")
export class MeController {
  @Get()
  me(@Req() req: AuthenticatedRequest) {
    // AuthGuard guarantees `auth` is present on non-public routes.
    const auth = req.auth!;
    const active = auth.memberships.find((m) => m.workspaceId === auth.activeWorkspaceId);
    return {
      user: auth.user,
      memberships: auth.memberships,
      activeWorkspace: active?.workspace ?? null,
      activeAgencyId: auth.activeAgencyId,
      role: auth.role,
    };
  }
}
