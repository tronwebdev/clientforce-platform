/**
 * INT W5 (DEC-102) — the Clientforce Zapier app definition.
 *
 * This file contains NO list of triggers and NO list of actions. Every step is
 * generated from the registries in `@clientforce/core` and
 * `@clientforce/integrations`, so the published app cannot drift from the
 * product: a capability that is not registered has no step, and a registered
 * capability nobody decided about fails the build long before it reaches
 * Zapier. That is the whole point — a hand-maintained app definition is a
 * second source of truth, and second sources of truth rot.
 *
 * Shipped as a PRIVATE app, usable by invite link. A public directory listing
 * is a separate owner-gated step and goes through Zapier's review process, so
 * nothing here claims a public listing.
 *
 * Auth is a workspace API key (v1 owner ruling, not OAuth): Zapier holds the
 * key and sends it as a bearer token; `/zapier/v1/me` is the auth test.
 */
import {
  ZAPIER_INBOUND_WRITE_KINDS,
  zapierInboundWriteSchemas,
  type ZapierInboundWriteKind,
} from "@clientforce/core";
import {
  buildZapierManifest,
  ZAPIER_TRIGGER_KEYS,
  ZAPIER_TRIGGERS,
  type ZapierTriggerKey,
} from "@clientforce/integrations";

export interface ZapierAppConfig {
  /** Base URL of the Clientforce API, e.g. https://api.clientforce.app */
  apiBaseUrl: string;
}

interface ZapierField {
  key: string;
  label: string;
  required: boolean;
  type: "string";
  helpText?: string;
}

/**
 * Input fields for an inbound write, derived from its zod contract rather than
 * retyped. Retyping is exactly how a form drifts from what the API accepts.
 */
function fieldsForWrite(kind: ZapierInboundWriteKind): ZapierField[] {
  const schema = zapierInboundWriteSchemas[kind];
  // The contracts are ZodEffects (`.strict().refine(...)`) wrapping an object;
  // unwrap to reach the shape.
  const inner = (schema as { _def?: { schema?: unknown } })._def?.schema ?? schema;
  const shape = (inner as { shape?: Record<string, unknown> }).shape ?? {};
  return Object.entries(shape).map(([key, def]) => {
    const isOptional = (def as { isOptional?: () => boolean }).isOptional?.() ?? true;
    return {
      key,
      label: key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
      required: !isOptional,
      type: "string" as const,
      ...(key === "email" || key === "phone"
        ? { helpText: "Provide an email or a phone number — the contact is matched on these." }
        : {}),
    };
  });
}

/** A polling trigger: Zapier calls the rail and de-dupes on the event `id`. */
function buildTrigger(key: ZapierTriggerKey, cfg: ZapierAppConfig) {
  const spec = ZAPIER_TRIGGERS[key];
  return {
    key,
    noun: spec.label,
    display: { label: spec.label, description: spec.help, hidden: false },
    operation: {
      type: "polling" as const,
      perform: {
        url: `${cfg.apiBaseUrl}/zapier/v1/triggers/${key}`,
        method: "GET" as const,
        params: { since: "{{bundle.meta.timestamp}}" },
      },
    },
  };
}

function buildInboundWrite(kind: ZapierInboundWriteKind, cfg: ZapierAppConfig) {
  const manifest = buildZapierManifest().creates.find((c) => c.key === kind)!;
  return {
    key: kind,
    noun: "Contact",
    display: { label: manifest.label, description: manifest.help, hidden: false },
    operation: {
      inputFields: fieldsForWrite(kind),
      perform: {
        url: `${cfg.apiBaseUrl}/zapier/v1/writes/${kind}`,
        method: "POST" as const,
        body: "{{bundle.inputData}}",
      },
    },
  };
}

/**
 * The steps the RAIL actually serves today. The exposure map is the DECISION
 * record — it is complete, and `buildZapierManifest()` reports all of it — but
 * a published app must only render steps a user can actually run. Rule-action
 * execution has to go through the engine's `executeAction` with fully-wired
 * `RuleEngineDeps` (the notify and CRM transports), which is its own piece of
 * work; until that lands, rendering those steps would ship a menu of 404s.
 * Tracked as Q-060. The pin below is what keeps this honest.
 */
export const IMPLEMENTED_CREATE_KEYS: readonly string[] = [...ZAPIER_INBOUND_WRITE_KINDS];

/** The whole app, assembled by enumeration. */
export function buildZapierApp(cfg: ZapierAppConfig) {
  return {
    version: "1.0.0",
    platformVersion: "15.5.1",
    authentication: {
      type: "custom" as const,
      fields: [
        {
          key: "apiKey",
          label: "Clientforce API key",
          required: true,
          type: "password" as const,
          helpText:
            "Settings → Integrations → Zapier → Mint API key. The key is shown once; if you lose it, mint a new one.",
        },
      ],
      test: { url: `${cfg.apiBaseUrl}/zapier/v1/me`, method: "GET" as const },
      connectionLabel: "{{label}}",
    },
    beforeRequest: [
      // Every request carries the key as a bearer token.
      "addApiKeyHeader",
    ],
    triggers: Object.fromEntries(
      ZAPIER_TRIGGER_KEYS.map((k) => [k, buildTrigger(k, cfg)]),
    ),
    // Only the implemented steps ship. See IMPLEMENTED_CREATE_KEYS.
    creates: Object.fromEntries(
      ZAPIER_INBOUND_WRITE_KINDS.map((k) => [k, buildInboundWrite(k, cfg)]),
    ),
  };
}

export type ZapierApp = ReturnType<typeof buildZapierApp>;
