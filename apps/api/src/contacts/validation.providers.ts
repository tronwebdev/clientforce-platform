import { resolveMx } from "node:dns/promises";
import type { Provider } from "@nestjs/common";
import { createValidationQueue, type ResolveMx } from "@clientforce/validation";

/**
 * LH1 (DEC-087): the api's two validation seams — the queue (null without
 * Redis: batch rows still land and the worker's requeue sweep picks them up)
 * and the light-pass MX resolver (tests inject a fixed one — CI never
 * touches the network, the DNS_CHECK_DEPS precedent).
 */
export const VALIDATION_QUEUE = "CONTACTS_VALIDATION_QUEUE";
export const VALIDATION_LIGHT_DEPS = "CONTACTS_VALIDATION_LIGHT_DEPS";

export interface ValidationLightDeps {
  resolveMx: ResolveMx;
}

export const validationProviders: Provider[] = [
  {
    provide: VALIDATION_QUEUE,
    useFactory: () => (process.env.REDIS_URL ? createValidationQueue() : null),
  },
  {
    provide: VALIDATION_LIGHT_DEPS,
    useFactory: (): ValidationLightDeps => ({ resolveMx: (domain) => resolveMx(domain) }),
  },
];
