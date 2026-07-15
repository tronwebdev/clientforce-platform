import type { Request } from "express";
import type { StaffRole } from "./staff-token";

/** The authenticated platform operator, attached by `BackofficeAuthGuard`. */
export interface BackofficeStaffContext {
  id: string;
  email: string;
  name: string | null;
  role: StaffRole;
}

export interface BackofficeRequest extends Request {
  staff?: BackofficeStaffContext;
}
