import { AiGatewayError, MissingPromptVarError } from "./types";

/**
 * Versioned prompt registry. Prompts are code: registered once at module load
 * (P1.3/P1.4/P1.7 own their entries), rendered with explicit variables, and
 * pinned by (name, version) so a prompt change is a diff — never a mystery.
 */
export interface PromptTemplate {
  name: string;
  version: number;
  template: string;
}

const registry = new Map<string, PromptTemplate>();

const key = (name: string, version: number) => `${name}@v${version}`;

export function registerPrompt(prompt: PromptTemplate): void {
  const k = key(prompt.name, prompt.version);
  if (registry.has(k)) {
    throw new AiGatewayError(
      `Prompt ${k} is already registered — bump the version instead of mutating`,
    );
  }
  registry.set(k, prompt);
}

export function getPrompt(name: string, version: number): PromptTemplate {
  const p = registry.get(key(name, version));
  if (!p) throw new AiGatewayError(`Prompt ${key(name, version)} is not registered`);
  return p;
}

/**
 * Render `{{var}}` placeholders. A referenced-but-missing variable throws —
 * silent empty interpolation is how bad sends happen.
 */
export function renderPrompt(
  name: string,
  version: number,
  vars: Record<string, string | number>,
): string {
  const { template } = getPrompt(name, version);
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, varName: string) => {
    if (!(varName in vars)) throw new MissingPromptVarError(key(name, version), varName);
    return String(vars[varName]);
  });
}

/** Test hook — keeps unit tests isolated from each other. */
export function clearPromptsForTest(): void {
  registry.clear();
}
