import { SetMetadata } from "@nestjs/common";
import type { Role } from "@clientforce/db";

export const IS_PUBLIC_KEY = "isPublic";
/** Mark a route as public (bypasses auth). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = "roles";
/** Restrict a route to the given roles (RBAC). */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
