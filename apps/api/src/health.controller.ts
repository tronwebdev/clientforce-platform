import { Controller, Get } from "@nestjs/common";
import { isConfigured } from "@clientforce/config";

interface HealthResponse {
  ok: boolean;
  configured: boolean;
}

@Controller()
export class HealthController {
  @Get("healthz")
  health(): HealthResponse {
    // Full health/readiness (DB, Redis, Temporal) is wired in later tickets.
    return { ok: true, configured: isConfigured() };
  }
}
