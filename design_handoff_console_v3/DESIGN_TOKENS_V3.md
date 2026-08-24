# DESIGN_TOKENS_V3 — "Quiet confidence" console (Apple pass, 2026-08-15)
Supersedes design_handoff_clientforce_restyle/DESIGN_TOKENS.md for console-family screens. Atoms: THIS DOC WINS (UI_PORTING_RULES).

> **BOLD AMENDMENT (2026-08-16) — read §Bold at the foot of this file.** Console Bold adds an elevation scale, a display type scale and recessed input wells on top of everything below. Where §Bold and the sections above differ, §Bold wins for Bold-era surfaces.

## Surfaces (neutralized — green lives in accents only)
wash #EFF1F0 · panel #FCFCFC · card #FFFFFF · hover #F6F7F7 · wells #F2F3F3
hairlines #ECEDEC / #F0F1F0 / #EAEBEA / #E2E4E3 (lightened Apple-pass set; legacy #E9EEEA family retired for console)
ambient shadow 0 1px 2px rgba(16,22,19,.045) — the ONLY grey shadow allowed

## Ink & text
ink #101613 · muted #5A6660 · faint #8B968F
Display: Schibsted Grotesk 800–900, tracking -.02/-.035em; page titles 900 @28px/-.04em with gradient ink linear-gradient(180deg,#101613 25%,#14743A 120%) via background-clip:text
Body/UI: IBM Plex Sans 400–700 · Data/IDs: IBM Plex Mono 500 (labels 9–10.5px, letter-spacing .06–.14em)

## Color ROLES (hard rule)
forest #146B33 = Ada / live / create / approve ONLY · mint chip #EAF5EE bd #CFE8D8
cyan #0E7D93 = navigate/inspect links (Open ›, View all) · tint #E2F3F6 bd #BFE3EB
amber #8A6D1A = needs-you/caution · #F7EFDA bd #EAD9A8 · danger #B0483A / #FBEEEA
slate #356170 = system/data · #EAF3F5 bd #CFE4E9
Signature gradient linear-gradient(135deg,#36D7ED,#35E834 55%,#D0F56B): logo mark + ≤2 moments/screen. Never fills or buttons.
Soft GREEN GLOWS allowed as live/active accents (hero metric, live row, Ada bar, focus capsule); structure stays hairline.

## Geometry
radius: controls 10–14 · cards 16–18 · sheets/containers 20 · pills 999
Internal pages sit in ONE colored container (soft tint per family: green campaign, cyan forms, green chatbot) — elements inside are white cards on it; no per-element backgrounds on wash.

## Tabs (entity rails: proposal/form/chatbot + campaign tabs)
Active = solid forest block, white 800 text, soft green glow, 14px labels; inactive quiet grey on #F1F2F1 track; hued icon chips ride the rows.

## Dock (Style A — CURRENT)
tile on: linear-gradient(180deg,rgba(255,255,255,.38),transparent 48%), signature gradient · bd rgba(16,22,19,.22) · ink mark
tile off: linear-gradient(180deg,rgba(255,255,255,.72),transparent 52%), gradient of the 3 logo hues @ .14–.20 alpha · bd rgba(53,232,52,.30) · ink mark
Marks = FILLED logo-glyph set (fill-rule evenodd, no stroke): envelope/person/bullseye/bolt-square/sheet/bubble-with-eyes/clipboard-check/three-bars/plug. Style B (alternating cyan/green/lime) saved in CONSOLE_V3_BUILD_NOTES §Dock styles.
Focus capsule: 27px tile, logo-gradient wash + white shine, dbl-chevron (2nd @40%), green glow, hover deepens.

## Add-on surfaces (Receptionist, Ads Closed Loop)
Add-on showcases are full-page marketing surfaces, dark-hero allowed, but the palette stays Clientforce: logo blues/greens (#36D7ED → #35E834 → #D0F56B family + forest #146B33). Third-party brand colors (Meta blue, Google red) were tried and REJECTED — provider identity is carried by the logo glyph only. Greyed/unentitled state: grayscale logo + .5-opacity skeleton. Film sheet: scrim rgba(8,11,20,.62)+blur(4px), stage 680px 16/9 radius 18, gradient(150deg,#0A2417,#0A1020 58%,#080B14), mono chapter label at .16em.

## Layout defect to avoid (cost an hour in design)
Cards inside `flex-direction:column; overflow-y:auto` panes MUST set `flex:none`, or the tallest panel collapses to ~2px and clips its content while still measuring as present in the DOM.

## Provenance
✦ marks anything AI-composed — ALWAYS with an honest provenance/receipt line.

---

# §Bold — Console Bold amendment (2026-08-16)
Applies to Console Bold, Business Core Onboarding, and the Bold skin pass on the agency suite and client portal.

## Shell metrics (fixed, not suggestions)
page `height:100vh · overflow:hidden · padding:26px · display:flex · gap:18px`
rail 228px · canvas flex:1 min-width:0 · dock 52px · dock tile 38px / radius 13 / gap 4
column pattern: header `flex:none` → scroll `flex:1; min-height:0; overflow-y:auto` → footer `flex:none`
every card inside a scrolling flex column: `flex:none`

## Elevation (amends "zero box-shadows")
Hairlines still carry structure. Hard grey drop shadows remain banned. These three are permitted:
- contact + ambient (cards, stages): `0 1px 2px rgba(16,22,19,.05), 0 14px 38px -14px rgba(16,22,19,.18)`
- subtle (rail panels, rows): `0 1px 2px rgba(16,22,19,.035)`
- primary action lift: `0 1px 2px rgba(16,22,19,.12), 0 8px 20px -8px rgba(20,107,51,.55)`
Soft green glow stays the live/active accent: `0 0 0 7px rgba(20,107,51,.045)`.

## Inputs — recessed wells (not more white boxes)
fill `#F4F6F5` · border `#E2E6E4` · radius 14 · `box-shadow: inset 0 1px 2px rgba(16,22,19,.05)`
Grouped fields share one well with `#E7EAE8` dividers rather than stacking separate boxes.

## Card gradient
Stage and plan cards: `linear-gradient(180deg,#FFFFFF 0%,#FCFDFC 50%,#F7FAF8 100%)` with border `#E4E7E5`, radius 22.
Page wash for focused screens: `radial-gradient(120% 90% at 78% -10%,#F3F6F4 0%,#EDF0EE 45%,#E7EBE9 100%)`.

## Type scale (Bold)
| Role | Spec |
|---|---|
| Auth / marketing hero | Schibsted 900 · 46px · -.04em |
| Page + stage title | Schibsted 900 · 34px · -.034/-.04em (gradient ink) |
| Card title | Schibsted 900 · 26px · -.034em |
| Row / tier title | Schibsted 900 · 16–19px · -.026/-.03em |
| Numbers (all) | Schibsted 900, tracking -.028/-.032em — **never mono** |
| Body | Plex Sans 400–500 · 13.5–16px · line-height 1.55–1.6 |
| Section eyebrow | Plex Mono · 9.5px · .18em · #8B968F |
| Stat / meta label | Plex Mono · 10px · .13em · #8B968F |
| Micro / IDs | Plex Mono · 8.5–10.5px · .06–.1em |

## Radius (Bold)
pill 999 · chip 12–13 · tile 13 · input well 14 · card 16–20 · stage 22

## Indicators
live dot `#35E834` 11px, 2px panel-coloured ring, `bPulse 1.6–2s`
warn dot `#E0A83A` 11px, solid
gradient hairline (stage top edge, 3px): the signature gradient — one per screen
