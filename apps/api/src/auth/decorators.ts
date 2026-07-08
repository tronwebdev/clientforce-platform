import { SetMetadata } from "@nestjs/common";
import type { Role } from "@clientforce/db";

export const IS_PUBLIC_KEY = "isPublic";
/** Mark a route as public (bypasses auth). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = "roles";
/** Restrict a route to the given roles (RBAC). */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

export const ALLOW_NO_MEMBERSHIP_KEY = "allowNoMembership";
/**
 * A3 (DEC-060): authenticated-but-membership-less principals may reach this
 * route (the first-run "Create workspace" endpoint) — everywhere else a user
 * with no membership stays 403 NO_WORKSPACE.
 */
export const AllowNoMembership = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_NO_MEMBERSHIP_KEY, true);
