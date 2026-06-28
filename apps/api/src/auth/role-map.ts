import { Logger } from "@nestjs/common";
import { Role } from "@clientforce/db";

/**
 * Clerk org-role → our Role, used ONLY to seed a membership's role at
 * just-in-time provisioning (first login to a Clerk org). Once a membership
 * exists, the DB role is authoritative and org_role is ignored.
 *
 * Override via AUTH_ROLE_MAP (JSON). Unmapped roles fall back to least privilege.
 */
const DEFAULT_ROLE_MAP: Record<string, Role> = {
  "org:owner": Role.OWNER,
  "org:admin": Role.ADMIN,
  "org:member": Role.AGENT,
  "org:viewer": Role.VIEWER,
};

const VALID_ROLES = new Set<string>(Object.values(Role));
const logger = new Logger("Auth");

function parseEnvMap(raw: string | undefined): Record<string, Role> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const out: Record<string, Role> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (VALID_ROLES.has(value)) out[key] = value as Role;
      else logger.warn(`AUTH_ROLE_MAP: ignoring "${key}" → "${value}" (not a valid Role).`);
    }
    return out;
  } catch {
    logger.warn("AUTH_ROLE_MAP is not valid JSON; using defaults.");
    return {};
  }
}

/** Map a Clerk org role to our Role, defaulting to VIEWER (least privilege). */
export function mapOrgRole(orgRole: string | undefined): Role {
  const map = { ...DEFAULT_ROLE_MAP, ...parseEnvMap(process.env.AUTH_ROLE_MAP) };
  return (orgRole && map[orgRole]) || Role.VIEWER;
}
