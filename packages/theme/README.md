# @clientforce/theme — console-v3 tokens

The **console-v3** design language as a shared token module — a typed, tested
mirror of **`CONSOLE_V3_CANON.md`** (repo root, LOCKED by the owner
2026-07-12). The canon doc is the source; this package is how code reads it.

- **Who consumes it today:** `@clientforce/widget` (the embeddable Agent
  Widget) — the first reference implementation of console-v3 in code.
- **Who adopts it next:** the future app re-skin unit re-themes `apps/web`
  from this same source.
- **Who must NOT import it:** the legacy skin — `packages/ui` (`--cf-*`
  tokens) and `apps/web` stay untouched until the re-skin unit. The `--cv3-`
  prefix guarantees zero collision even if both sheets ever load together.

## Files

- `src/console-v3.css` — the token source: canon §1 color · §2 semantic
  labels (pipeline temperature ramp + channel tints) · §3 type · §4
  radius/space/elevation · §5 motion. Scoped `:root, :host` so it works at
  document level and inside shadow roots. The only file in this package
  allowed raw color literals (stylelint override, same rule as
  `packages/ui/src/tokens.css`).
- `src/index.ts` — typed mirror (`consoleV3Vars`), the agent mark + default
  name (§6), the four widget chat verbs and five console states with the
  recorded mapping, and the contrast helpers.
- `test/tokens.test.ts` — **reads `CONSOLE_V3_CANON.md` itself** and pins the
  tokens against the doc's own tables (§1 colors row-for-row, §2 ramp + channel
  tints, §5 motion timings), plus the canon's hard rules: retired values never
  return (`#16A82A`, `#0F7A28`, the warm creams, the dark sidebar), `#35E834`
  only in the signature gradient + motion, exactly two shadow tokens, the
  Direction-D type stacks, and the four-verb widget rule.

## The rules that bite

- **Forest `#146B33`** is THE accent (`#0F5227` hover/pressed).
- **`#35E834` never fills anything** — signature gradient and motion only.
- **Direction D type:** Schibsted Grotesk for display AND body/UI; IBM Plex
  Mono for data/IDs/timestamps only. (Not IBM Plex Sans — the doc's §3 is
  explicit, and a test pins it.)
- **Elevation:** two float values exist; everything else is a hairline. The
  widget's launcher + panel are the documented exception.
- **Light-first:** there is no dark canon. Don't port legacy dark literals.
