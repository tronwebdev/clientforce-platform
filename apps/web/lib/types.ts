export type Role = "OWNER" | "ADMIN" | "AGENT" | "VIEWER";

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

/** Shape returned by the API's GET /me. */
export interface Me {
  user: { id: string; email: string; name: string | null };
  memberships: MembershipView[];
  activeWorkspace: WorkspaceView | null;
  activeAgencyId: string;
  role: Role;
}

export interface Contact {
  id: string;
  workspaceId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  createdAt: string;
}
