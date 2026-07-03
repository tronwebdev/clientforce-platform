import { afterEach, describe, expect, it } from "vitest";
import { clearPromptsForTest, getPrompt, registerPrompt, renderPrompt } from "../src/prompts";
import { MissingPromptVarError } from "../src/types";

afterEach(clearPromptsForTest);

describe("prompt registry", () => {
  it("registers and renders a versioned template", () => {
    registerPrompt({
      name: "classify-intent",
      version: 1,
      template: "Classify: {{body}} for {{company}}",
    });
    expect(renderPrompt("classify-intent", 1, { body: "hello", company: "Acme" })).toBe(
      "Classify: hello for Acme",
    );
  });

  it("throws on a missing variable instead of interpolating empty", () => {
    registerPrompt({ name: "p", version: 1, template: "Hi {{firstName}}" });
    expect(() => renderPrompt("p", 1, {})).toThrow(MissingPromptVarError);
  });

  it("pins by version and rejects duplicate registration", () => {
    registerPrompt({ name: "p", version: 1, template: "v1" });
    registerPrompt({ name: "p", version: 2, template: "v2 {{x}}" });
    expect(getPrompt("p", 2).template).toContain("v2");
    expect(() => registerPrompt({ name: "p", version: 1, template: "again" })).toThrow(
      /already registered/,
    );
    expect(() => getPrompt("p", 3)).toThrow(/not registered/);
  });
});
