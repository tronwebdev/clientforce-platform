/**
 * INT W5 (DEC-101) — the app definition is GENERATED, and this pins that it
 * only ever ships steps the rail can actually serve. The failure mode being
 * guarded is a published app whose menu contains a step that 404s, which a
 * Zapier user discovers only after building a Zap around it.
 */
import { describe, expect, it } from "vitest";
import { ZAPIER_INBOUND_WRITE_KINDS } from "@clientforce/core";
import { buildZapierManifest, ZAPIER_TRIGGER_KEYS } from "@clientforce/integrations";
import { buildZapierApp, IMPLEMENTED_CREATE_KEYS } from "./index";

const app = buildZapierApp({ apiBaseUrl: "https://api.example.test" });

describe("the Zapier app definition", () => {
  it("renders every derived trigger, and only those", () => {
    expect(Object.keys(app.triggers).sort()).toEqual([...ZAPIER_TRIGGER_KEYS].sort());
  });

  it("renders ONLY steps the rail implements — never a menu of 404s", () => {
    // The exposure map is the decision record and is deliberately WIDER than
    // what ships; the app must be the narrower, honest set.
    expect(Object.keys(app.creates).sort()).toEqual([...IMPLEMENTED_CREATE_KEYS].sort());
    for (const key of Object.keys(app.creates)) {
      expect(IMPLEMENTED_CREATE_KEYS).toContain(key);
    }
  });

  it("the shipped surface is a SUBSET of the decided surface", () => {
    const decided = new Set(buildZapierManifest().creates.map((c) => c.key));
    for (const key of Object.keys(app.creates)) expect(decided.has(key)).toBe(true);
  });

  it("derives write input fields from the zod contract rather than retyping them", () => {
    const create = app.creates.create_contact!;
    const keys = create.operation.inputFields.map((f) => f.key);
    expect(keys).toContain("email");
    expect(keys).toContain("phone");
    expect(keys).toContain("firstName");
    // Nothing the contract does not accept may appear as a field.
    expect(keys).not.toContain("workspaceId");
    expect(keys).not.toContain("id");
  });

  it("points every step at the versioned rail under the configured base URL", () => {
    for (const t of Object.values(app.triggers)) {
      expect(t.operation.perform.url).toMatch(/^https:\/\/api\.example\.test\/zapier\/v1\/triggers\//);
    }
    for (const c of Object.values(app.creates)) {
      expect(c.operation.perform.url).toMatch(/^https:\/\/api\.example\.test\/zapier\/v1\/writes\//);
    }
    expect(app.authentication.test.url).toBe("https://api.example.test/zapier/v1/me");
  });

  it("authenticates with an API key, never OAuth (v1 owner ruling)", () => {
    expect(app.authentication.type).toBe("custom");
    expect(app.authentication.fields[0]!.key).toBe("apiKey");
    expect(app.authentication.fields[0]!.type).toBe("password");
  });

  it("ships no send step under any name", () => {
    const surface = JSON.stringify(app).toLowerCase();
    expect(surface).not.toContain("send_to_channel");
    expect(surface).not.toContain("send email");
    expect(surface).not.toContain("send sms");
  });

  it("every inbound write kind reaches the app", () => {
    for (const kind of ZAPIER_INBOUND_WRITE_KINDS) expect(app.creates[kind]).toBeDefined();
  });
});
