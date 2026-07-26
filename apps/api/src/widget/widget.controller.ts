/**
 * The widget's ONE public endpoint (WID2, DEC-101).
 *
 *   POST /widget/v1/session
 *
 * `@Public()` like the vendor webhook controllers, but the authenticity model
 * is different and worth stating plainly: a webhook proves itself with a shared
 * secret, whereas this rail is **deliberately unauthenticated** — the whole
 * point of an embed is that any visitor on a customer's page can talk to it.
 * What protects the tenant is therefore not a secret but the shape of the
 * surface: the `wgt_…` id resolves server-side (no tenant id ever reaches the
 * page), an optional origin allow-list, hard per-session and per-widget caps,
 * and a body that must satisfy the shared zod contract before anything runs.
 *
 * Refusals are typed and visitor-safe: the detail strings in `WIDGET_REFUSALS`
 * are written for a stranger on somebody else's website, so they never name a
 * tenant, an id, or whether a thing exists.
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpException,
  NotFoundException,
  Post,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { WIDGET_REFUSALS, widgetSessionRequestSchema } from "@clientforce/core";
import { Public } from "../auth/decorators";
import { WidgetRefusal, WidgetService } from "./widget.service";

@Controller("widget/v1")
export class WidgetController {
  constructor(private readonly widget: WidgetService) {}

  @Public()
  @Post("session")
  async session(@Body() body: unknown, @Headers("origin") origin?: string): Promise<unknown> {
    const parsed = widgetSessionRequestSchema.safeParse(body);
    if (!parsed.success) {
      // A version mismatch is the one parse failure a visitor can act on
      // (reload the page), so it gets its own refusal.
      const versionIssue = parsed.error.issues.some((i) => i.path[0] === "contractVersion");
      throw new BadRequestException({
        code: versionIssue ? "CONTRACT_VERSION" : "BAD_REQUEST",
        detail: versionIssue ? WIDGET_REFUSALS.CONTRACT_VERSION : "Malformed request",
      });
    }

    try {
      return await this.widget.handle(parsed.data, origin);
    } catch (err) {
      if (err instanceof WidgetRefusal) throw this.toHttp(err);
      throw err;
    }
  }

  private toHttp(refusal: WidgetRefusal): HttpException {
    const payload = { code: refusal.code, detail: refusal.message };
    switch (refusal.status) {
      case 404:
        return new NotFoundException(payload);
      case 403:
        return new ForbiddenException(payload);
      case 429:
        return new HttpException(payload, 429);
      case 503:
        return new ServiceUnavailableException(payload);
      default:
        return new UnprocessableEntityException(payload);
    }
  }
}
