# @clientforce/theme — console-v3 tokens

The **console-v3** design language as a shared token module: light surfaces,
hairline structure, forest accent, agent-identity motion states, signature
gradient used sparingly.

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
  (`textOnColor` — the Agent Widget prototype's `ink()` verbatim), and the
  agent-identity motion-state names (`AGENT_STATES`).
- `test/tokens.test.ts` — pins CSS ↔ TS parity in both directions plus the
  §1 AA contrast rule (vivid green is never a text color).

## Provenance (Q-047 — provisional pending the owner's mock)

Every value is lifted from canonical sources only:
`design_handoff_clientforce_restyle/DESIGN_TOKENS.md` (atoms) and
`design_handoff_clientforce_restyle/prototypes/Agent Widget.dc.html`
(widget-surface literals: panel/launcher shadows, dark-theme set, presence
dot, identity gradient). No invented colors. When the owner's console-v3 mock
lands, deltas are applied here and every consumer re-themes from this one
source.
