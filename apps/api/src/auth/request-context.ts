import type { Request } from "express";
import type { Role } from "@clientforce/db";

export interface WorkspaceView {
  id: string;
  name: string;
  slug: string;
  agencyId: string;
}

export interface MembershipView {
  workspaceId: string;
  role: Role;
  workspace: WorkspaceView;
}

/** Resolved auth + tenant context attached to each authenticated request. */
export interface RequestAuthContext {
  user: { id: string; email: string; name: string | null };
  memberships: MembershipView[];
  activeWorkspaceId: string;
  activeAgencyId: string;
  role: Role;
}

export interface AuthenticatedRequest extends Request {
  auth?: RequestAuthContext;
}
