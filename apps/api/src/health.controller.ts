import { Controller, Get } from "@nestjs/common";
import { isConfigured } from "@clientforce/config";
import { Public } from "./auth/decorators";

interface HealthResponse {
  ok: boolean;
  configured: boolean;
}

@Controller()
export class HealthController {
  @Public()
  @Get("healthz")
  health(): HealthResponse {
    // Liveness only. Deep readiness (DB/Redis/Temporal) is wired in later tickets.
    return { ok: true, configured: isConfigured() };
  }
}
