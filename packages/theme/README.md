# @clientforce/theme — console-v3 tokens

The **console-v3** design language as a shared token module: light surfaces,
hairline structure, forest accent (`#146B33`), agent-identity motion states,
signature gradient used sparingly.

- **Who consumes it today:** `@clientforce/widget` (the embeddable Agent
  Widget) — the first reference implementation of console-v3 in code.
- **Who adopts it next:** the future app re-skin unit re-themes `apps/web`
  from this same source.
- **Who must NOT import it:** the legacy skin — `packages/ui` (`--cf-*`
  tokens) and `apps/web` stay untouched until the re-skin unit. The `--cv3-`
  prefix guarantees zero collision even if both sheets ever load together.

## Files

- `src/console-v3.css` — the token source (CSS custom properties, scoped
  `:root, :host` so it works both at document level and inside shadow roots).
  The only file in this package allowed raw color literals (stylelint
  override, same rule as `packages/ui/src/tokens.css`).
- `src/index.ts` — typed mirror (`consoleV3Vars`), contrast helpers
  (`textOnColor`), and the agent-identity motion-state names
  (`AGENT_STATES`).
- `test/tokens.test.ts` — pins CSS ↔ TS parity in both directions plus the
  canon hard rules: the vivid green `#35E834` lives ONLY in the signature
  gradient + motion (never a fill/button/text — vivid-as-fill is retired),
  zero box-shadows except the launcher + panel float, the retired
  pre-refresh green (`#16A82A`/`#0F7A28`) never returns, and the canon
  radii/type scales.

## Binding source (owner ruling 2026-07-22 — Q-049)

The **Console v3 Build Spec + the owner's mock** are the binding token
source; the values here are the canon set the owner relayed at the unit-27
review (forest `#146B33`/hover `#0F5227` · wash/panel/card surfaces · the
three hairlines · mint/warn/danger · Schibsted Grotesk + IBM Plex type ·
the 9–12/14–16/22/999 radii scale · the zero-shadow rule). They SUPERSEDE
the legacy Agent Widget prototype literals this module first shipped with.
The spec/mock files land in-repo with the Q-049 fidelity pass; a handful of
widget-specific tokens with no canon value yet (presence dot, badge, orb
overlay, the dark theme set) keep their prototype literals and are flagged
`carryover pending spec` in the source.
