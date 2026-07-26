# §8 evidence — WID · Agent Widget embed (unit 27, DEC-097)

**Comparison basis (owner ruling 2026-07-22):** FLOW COMPOSITION is bound to
the live-preview panel inside
`design_handoff_clientforce_restyle/prototypes/Agent Widget.dc.html`
(UI_PORTING_RULES screen map → "Agent Widget") and is unchanged. The VISUAL /
TOKEN layer is **`CONSOLE_V3_CANON.md`** (repo root, LOCKED 2026-07-12) — forest
`#146B33`, canon surfaces/hairlines, Schibsted Grotesk (Direction D), the ✦
agent mark, light-first, flat hairline interiors — and it **intentionally
diverges from the prototype's legacy skin**. The pairs below are therefore
COMPOSITION comparisons, not pixel comparisons. Panel-internal placement is
bound to the committed panel mock instead — see the last section.

**The panel mock is now IN the repo** — `widget-panel-canon.png` (the owner
uploaded it to `main`; it is the placement source for everything panel-internal).
The pass against it is the last section of this file.

**Capture:** 1440×900 (narrow-viewport frame 390×844), dev-local Playwright
against the preinstalled Chromium; capture script lives outside the repo and is
not committed (G-fidelity discipline). **Route-interception disclosure (the
P5-W2/w3-4 precedent):** the sandbox blocks unpkg + gstatic egress from the
browser, so the prototype's React 18 UMD came from the npm registry tarball and
the Google-Fonts CSS/woff2 sets (legacy families for the prototype page,
Schibsted Grotesk + IBM Plex Mono for the build) were prefetched through the
proxy and served locally — pixel-true assets, zero live egress at capture. The
build frames opt into `fontLoading:"google"` so the canon faces render; the
embed's DEFAULT is the system stack with zero third-party requests.

The build pages run the real bundle (`dist/clientforce-widget.js`) on the demo
host page, whose global styles are deliberately hostile (Comic Sans
`!important`, `border-radius: 0 !important`, purple buttons — visible on the
demo's own control strip in every frame): the shadow boundary holding IS the
isolation evidence. Conversation frames are earned through the real client seam
— the visitor turn travels `WidgetTransport` → stub → reply; the stub reply SAYS
it is stubbed (no live agent exists this unit).

## Frames

| Composition pair (token layer diverges by design) | Prototype                             | Build                       |
| ------------------------------------------------- | ------------------------------------- | --------------------------- |
| Default (light, right)                            | `proto-01-design-default-light-right` | `build-02-open-panel-light` |
| Position left                                     | `proto-03-design-position-left`       | `build-08-open-panel-left`  |

**No dark pair:** canon §7 is light-first — there is no dark canon, so the
legacy dark set was dropped and the widget ships no dark theme.

Build-only states (no static proto anchor — the preview is a single frame):

- `build-01-closed-launcher-right-light` — launcher with the brand mark + label pill (flat + hairline) + accent unread badge
- `build-03-thinking-during-roundtrip` — motion **spin**: the mark's conic ring + typing dots, mid seam round-trip
- `build-04-stub-reply-honest` — the honest stub reply + mint visitor bubble
- `build-05-agent-state-listening` — motion **ping** (border ring)
- `build-06-agent-state-replying` — motion **slide** (sweep under the mark) + dots
- `build-09-brand-ink-auto-contrast` — brand `#101613`, auto text-on-brand flips to white
- `build-10-closed-unread-badge` — post-conversation closed state
- `build-11-narrow-viewport-390` — the FULL-BLEED narrow-viewport panel (owner rule, DEC-100)
- `build-15-narrow-closed-launcher` — narrow + closed: the launcher still corners per config
- `build-12-panel-crop-3x` — the panel alone at 3× (1128×1920), the like-for-like pair for `widget-panel-canon` (1134×1926). Captured under `prefers-reduced-motion: reduce`, because at rest the idle mark BREATHES (§5, scale 1→1.05) and would inflate a geometry measurement by ~2px; that also makes this frame the reduced-motion evidence.
- `build-13-white-label-panel-3x` — the same panel with attribution suppressed by the server: ✦ tiles on the workspace accent, accent send + chip label, **no platform line**
- `build-14-white-label-launcher` — the white-label launcher: the ✦ on the accent in place of the brand mark

**Read `build-04` with the caret in mind:** its composer wears the focus ring
because the frame is taken right after typing, so the field genuinely holds
keyboard focus. `build-02` / `build-12` are the rest state — no ring. That pair
is the evidence that the ring is interaction-only rather than parked.

## Flagged deviations (all logged under DEC-097)

1. **Label pill hidden while the panel is open** — the static preview shows both; on a live page the copy would double.
2. **Messages scroll region** (max-height 342px) — the preview is static; a live thread needs a cap + scroll.
3. ~~**Narrow viewports: bottom-anchored**~~ — **RETIRED (DEC-100).** The owner ruled the narrow-viewport behaviour as a written spec: below 480px the panel is full-bleed. Built and evidenced; see the narrow-viewport section.
4. **Typing-dots indicator** during thinking/replying — standard chat pattern, no canon anchor in the preview.
5. **Composer focus = outline ring** on `:focus-visible` via `:has()` (flat — canon §4 allows no third shadow).

## Closed by canon (no longer deviations)

The kickoff's flagged prototype literals are all resolved by
`CONSOLE_V3_CANON.md` §6/§7 and are now canon, not deltas: the **✦ agent mark
on the signature gradient** (replacing the prototype's hard-coded platform mark
and the kickoff's agent-initial orb) · **accent presence dot** and **accent unread
badge with white numerals + 2px white ring** (canon forest by default — §7's
brand-green rule) · **no dark theme** · **canon
motion verbs and timings** (and the launcher's decorative bob removed — §5 is
event-driven only). The voice overlay now has a committed placement
anchor (`widget-voice-overlay.png`) and a measured spec in the last section, but
it is still honest-absent in the build: it needs a voice transport (Q-049/Q-050).

---

## Mock-fidelity pass — `Agent Widget v3 — Mock` (2026-07-26, DEC-098)

**Mock image: NOT COMMITTED — the file never reached this environment.** The
owner supplied it inline; only `CONSOLE_V3_CANON.md` arrived as an uploadable
file, so there are no PNG bytes to commit here. This pass was run against the
mock as delivered (its specs are transcribed below so the findings stand on
their own); committing `agent-widget-v3-mock.png` under this directory remains
open on Q-049.

**What the mock frame does and does not show.** It is an _interactive_ mock
("Interactive · try every flow"); the static frame renders the host-website
shell, a FLOWS-SHIPPED list, two KEY SURFACES specs, and BUILD NOTES — **the
open widget panel is not visible in it**. So panel-internal placement still has
no image anchor and stays bound to the prototype composition (the standing
ruling); everything the mock _does_ state explicitly is now honored or logged
below.

### Conforms already

| Mock says                                                                                                    | Build                                                                          |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| "Shadow is the one brand exception — launcher + panel float; everything inside stays flat + hairline per v3" | Pinned by test: `box-shadow` appears exactly twice, both the canon float token |
| "Isolation — ships in shadow DOM"                                                                            | One host element, open shadow root, `all: initial`, inlined sheet              |
| "Accent is the one customer-brandable token"                                                                 | `appearance.brandColor` is the only color knob; everything else is canon       |
| "Live voice mode is a _light_ overlay, not the retired dark surface"                                         | No dark set exists; the widget is light-first                                  |

### Deltas found and FIXED in this pass

1. **NO EMOJI (build note).** The build still shipped the legacy emoji as
   iconography — `📅 📞 📄` on the quick-action chips, `🎙` on the mic, `➤` on
   send, `✕` on close. All are now **stroke line icons** on `currentColor`
   (`src/ui/icons.ts`, standard 24×24 geometry per the PROGRESS icon map),
   rendered inline so the bundle still fetches nothing. The ✦ mark stays. The
   seam's quick-action labels are emoji-free too — the client draws the icon per
   `kind`, so a server-supplied label can never smuggle an emoji back in.
   Pinned by test (`Emoji_Presentation` must not appear in the shell or the
   transport).
2. **Launcher treatment (KEY SURFACES).** Mock: "brand mark on **white**". The
   build had the ✦ on the brand fill. The launcher is now a **white surface with
   a hairline**, and the mark is **gradient-painted** (canon §6 — signature
   gradient via `background-clip: text`). The accent no longer paints the
   launcher; it stays on the send button, chip text, rings and badge.

### Open — needs the owner or a later unit

3. **`assets/mark.svg` is not in the repo.** The mock names the launcher art as
   that file. The build uses the canon ✦ glyph as the mark, which is a faithful
   stand-in but not the real logo mark — dropping in the SVG is a one-line
   change once supplied.
4. **Flow parity is a scope gap, not a defect.** The mock lists six flows as
   shipped — Book a visit (qualify → capture → **live slot pick** → confirmed
   card) · Call me back — live (**animated dialing/ringing/live/done** +
   transcript quote) · Schedule callback (later time + SMS-reminder consent) ·
   Instant estimate (goal → email → **generating** → sent card with document) ·
   Live voice mode (**voice overlay**) · Ask a question (grounded FAQ + nudge).
   Unit 27's dispatch scoped the shell, the config surface and a stubbed seam;
   every one of these flows needs the server half (slots, dialing state,
   generation, voice transport). They are the next unit's work, riding Q-050,
   and **none of them can be faked client-side** — a slot picker with no
   calendar or a "dialing" animation with no call would be exactly the invented
   surface the repo forbids.
5. **Outcome card** ("mint confirm, forest ✓, receipt") — the terminal surface of
   every flow above. Its canon is recorded; it ships with the flows, since
   rendering "Booked · Tue 10:30 AM" without a booking would be fabricated data.
6. **Flow naming.** The mock's labels are clinic-flavoured ("Book a visit",
   "Instant estimate") where the build carries the prototype's ("Book a call",
   "Get a proposal"). Labels are server-offered per tenant in the contract, so
   this needs no client change — flagged so the wiring unit picks the canonical
   default set.
7. **Conflict, flagged not silently chosen:** the mock says the launcher carries
   an "unread **pip**"; canon §7 specifies "forest fill, **white numerals**, 2px
   white ring". The build ships the canon numbered pip (small forest dot, white
   ring, numeral inside). One word from the owner switches it to a numberless
   dot.
8. **Welcome-copy emoji.** The default welcome message is still the prototype's
   `Hi! 👋 How can I help?`. The build note retires emoji as _iconography_; this
   is owner-configurable **copy**, so it was left alone rather than changed
   silently — flagged for a ruling.

---

## Panel-spec round — owner screenshot ruling (2026-07-26, DEC-098 amendment)

The owner reviewed a build frame and ruled the shell off-canon on six points.
All six are fixed; the frames above are the result.

| Was                                        | Now                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header a solid forest fill with white text | Header on `panel` `#FBFDFB` with a `#E9EEEA` hairline bottom — **the accent never paints a surface**; mark = 38px tile at radius 11 on the signature gradient, name ink 800/15.5px, subtitle muted behind a forest dot, close in faint `#8B968F`                                                      |
| Composer wearing a heavy forest ring       | White fill, `#DCE5DE` hairline, radius 15; mic a 32px white circle with hairline, send a 32px forest circle. The ring is keyboard-focus only — **opening now focuses the panel, not the field**, so nothing is parked (a focused text field always matches `:focus-visible`, which is what parked it) |
| `👋` in the welcome copy                   | Owner copy, emoji-free: _"Hi — I'm Ada, [business]'s assistant. I can book you in, call you back, send an estimate, or answer a question."_ — derived from the agent + new `businessName` config                                                                                                      |
| No footer                                  | Every panel carries **Powered by Clientforce Ai** — 10.5px faint behind an 11px gradient square                                                                                                                                                                                                       |
| Bubbles on wash/mint                       | Agent `#F2F6F3` + ink at `5px 14px 14px 14px` (notch toward the mark); visitor ink `#101613` with `#FBFDFB` text at `14px 14px 4px 14px`                                                                                                                                                              |
| Panel 344px, corner-mapped radius          | 376×640, radius 20 at the shipped default corner                                                                                                                                                                                                                                                      |

Each of these is now a structural pin in `packages/widget/test/canon.test.ts`
(header surface + text tones, mark tile, composer geometry, no `:focus-within`
ring, bubble values, panel geometry, the platform line), so the shell cannot
drift back.

**Still open on Q-049:** the mock PNG itself (no file reached the session) and
`assets/mark.svg` — the owner is delivering the mark next turn, at which point
it is committed and the ✦ glyph stand-in is swapped for it. Also flagged: the
platform line is mandatory per canon while the product is white-label
(`CLAUDE.md`) — worth a ruling on whether an agency tier may suppress it.

---

## Brand mark, white-label + flow toggles (2026-07-26, DEC-098 amendment 2)

- **`packages/theme/assets/mark.svg` committed** and swapped in for the ✦
  stand-in on the launcher and the header tile, per the owner's ruling. It sits
  in the theme layer because console and widget consume the same file; the
  widget inlines it, so the embed still fetches nothing. **Message-row avatars
  keep the ✦ agent mark** (canon §6) — the platform logo beside every agent
  message would be the first thing a white-label agency asks to remove. Say if
  they should carry the mark too. This closes the `mark.svg` half of Q-049.
- **Platform attribution is plan-gated, not a toggle.** The line is default-on
  and can only be suppressed by the server sending
  `branding.platformAttribution: false` (the agency-tier plan check). There is
  no data-attribute and no init option — a test asserts a host page passing
  `data-platform-attribution="false"` / `data-white-label="true"` changes
  nothing, because a page-level switch would hand every customer white-label
  for free.
- **Six flows, workspace-configurable.** Book a visit · Call me back · Schedule
  callback · Get an estimate · Live voice (composer mic) · Ask a question — each
  independently enabled, the panel rendering only the active ones with no
  placeholder. This is the ungated workspace layer, same as accent and logo. The
  §8 frames run the mock's own subset (schedule-callback off) so the chip row
  matches the mock exactly.
- **Canon amended** (both gaps this unit found): §1 gains the `bubble-agent`
  `#F2F6F3` row, §7 gains the platform-attribution clause plus the explicit
  two-layer split. The theme test reads those rows straight from the doc — the
  §1 parser guard went 15 → 16 rows on the amendment, which is how the new row
  proved itself.

---

## Panel placement pass — `widget-panel-canon.png` (2026-07-26, DEC-098 amendment 3)

The mock finally landed as a file, so this is the real placement pass: the mock
and `build-12-panel-crop-3x` are both 3× crops of the panel, measured
pixel-for-pixel with the same script (dev-local, not committed) and divided by 3
for CSS px. **Everything below is measured, not eyeballed.**

### Matches (no change needed)

| Property                      | Mock                                    | Build                 |
| ----------------------------- | --------------------------------------- | --------------------- |
| Panel width · border · radius | 376 + 1px `line` · 20                   | 376 + 1px `line` · 20 |
| Header height · hairline      | 66 · `line` bottom                      | 66 · `line` bottom    |
| Mark tile · inset             | 38 at 16/14                             | 38 at 16/14           |
| Surfaces                      | header/foot `panel`, thread `card`      | same                  |
| Bubble fill · notch · left    | `#F2F6F3` · 5/14/14/14 · 51             | same                  |
| Bubble → chip gap             | 13                                      | 13                    |
| Chip gaps (row + column)      | 8 · 8                                   | 8 · 8                 |
| Composer height · insets      | 48 · 12/12                              | 48 · 12/12            |
| Send circle                   | 32, forest                              | 32, accent (= forest) |
| Foot pad-top · footer         | 9 · 10.5px faint + 11px gradient square | same                  |
| Text tones                    | ink / muted / faint / forest dot        | same                  |

### Deltas found and FIXED in this pass

| Was                                   | Mock says                                                                                             | Now                                                                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Composer at radius 15                 | a 48px-tall **pill** (its ends are true semicircles — measured, and radius 15 does not fit the curve) | `--cv3-radius-pill`; **conflicts with the written "radius 15"** — the mock wins as the placement source, flagged here for a one-word ruling |
| Mic 32px                              | 34 (34 + 6/6 padding + hairline = the measured 48)                                                    | 34                                                                                                                                          |
| Chips `padding: 10px 16px` (≈40 tall) | 32 tall, `0 14px`                                                                                     | `height: 32px; padding: 0 14px`                                                                                                             |
| Chip hairline `line-input` `#DCE5DE`  | `line-soft` `#E2EAE4`                                                                                 | `line-soft`                                                                                                                                 |
| Chip label ink                        | muted `#5A6660` (primary stays forest on mint)                                                        | muted                                                                                                                                       |
| Message orb 28 at radius 9            | 26 at radius ~7–8 (the tile's 38/11 proportion scaled)                                                | 26 at radius 8                                                                                                                              |
| Chip row indented 37                  | 35 — flush with the bubble's left edge                                                                | 35                                                                                                                                          |
| Row gap 14                            | 12                                                                                                    | 12                                                                                                                                          |
| Agent bubble capped at 82%            | runs the full row (308 measured vs 280 built) — it changes where the greeting WRAPS                   | 100% for the agent row (flex shrink caps it at 309); the visitor bubble keeps 82%                                                           |
| Close ✕ an 8px glyph                  | 11px at a ~2px stroke                                                                                 | icon at 22 with `stroke-width: 2`                                                                                                           |

### Ruled by the owner (2026-07-26) — all four settled

| Question raised by the pass                                | Ruling                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Composer: the mock's **pill** vs the written **radius 15** | **Pill wins — amend canon, not the build.** "A 48-tall bar at radius 15 reads as a rounded rectangle and loses the composer's softness against the squarer cards around it." Canon §4 now carries the widget pill exception (composer + entry chips).                                                                                                       |
| Panel height: mock **592** vs written **640**              | **640 ships.** The mock's 592 is the demo viewport clamping `max-height`, not design intent.                                                                                                                                                                                                                                                                |
| Type: the mock renders **~5% smaller** than canon §3       | **Canon type ships**, for the stated reason — atoms follow the token doc, composition follows the mock. An 89 vs 85 bubble is the right price.                                                                                                                                                                                                              |
| Presence dot + mint chip fill under white-label            | **Split the greens by MEANING, not appearance.** Decorative/brand green derives from `--cfw-brand` — the presence dot and the entry-chip fill are both in that bucket (a forest dot on a `#1F3A93` panel reads as a rendering bug). Semantic green stays canon: an outcome confirmation is green because it means _good_, not because it means Clientforce. |

Implemented: the presence dot and the chip fill/border now derive from the
accent. `--cfw-brand-tint` / `--cfw-brand-tint-line` carry **canon mint verbatim**
for the canon accent, so the default panel stays byte-identical to the mock
(measured: dot `#146B33`, chip fill `#EAF5EE`, chip border `#CFE8D8` — the mock's
exact values); any other accent falls through to a `color-mix` tint (measured on
`build-13`: dot `#1F3A93`, fill `#EDEFF6`, border `#CED4E7`). **Outcome cards are
deliberately NOT written** — they are the semantic-green surface and are
honest-absent until the flows ship (Q-050); canon §7 now records that they keep
mint/forest on every panel, white-label or not. Both halves are pinned by test,
including "no bare `--cv3-mint` survives in the sheet".

### Found while capturing — three defects fixed

- **`appearance.brandColor` barely reached the panel.** `--cfw-brand` painted
  only the white-label ✦ while the send circle, unread badge, chip label and
  focus rings were hard-wired to `--cv3-forest` — so the accent, which the mock's
  own build notes call "the one customer-brandable token", did almost nothing.
  Those now ride `--cfw-brand`, whose default IS canon forest, so a default panel
  is unchanged (measured: `build-12`'s send is `#146B33`) while a branded one is
  actually branded (`build-13`). The presence dot is excluded per §7 above.
- **`update()` dropped `businessName`**, silently reverting the welcome copy to
  "your assistant" on any later `update` call. Regression test added.
- **`update({ apiBase })` never reached the seam** — the transport was built once
  in the constructor, so switching to a live API did nothing. It is rebuilt on
  change now (an injected transport still wins). This is also what makes the
  white-label frame honest: it runs the real `HttpTransport`.

### White-label evidence (route-interception disclosure)

`build-13` / `build-14` are the only frames that do not use the stub. Suppressing
the platform line is server-authoritative — there is deliberately no client knob
— so the frame has to come from a session response carrying
`branding: { platformAttribution: false }`. Playwright fulfils
`POST https://widget-api.test/widget/v1/session` with a canned body (CORS +
preflight included) and the widget runs its real `HttpTransport` against it. The
workspace accent is `#1F3A93`, deliberately nothing like forest, so the swap is
unambiguous: **the signature gradient is gone from the header tile, the message
orbs and the launcher; the ✦ agent mark stays** (it is the agent's identity, not
platform branding) on the workspace's own accent, and the "Powered by
Clientforce Ai" line is absent. No page-level attribute can reproduce this —
that is pinned by test.

---

## Narrow viewports — owner rule, built (2026-07-26, DEC-100)

No image anchor by design: the mock is desktop-only, so this is a **written
rule** rather than a placement comparison, and the flagged "bottom-anchored /
centred 300px panel" deviation is retired with it.

**Below 480px the panel goes full-bleed** — `inset: 0`, radius 0, full width and
height, **no float shadow**: it is no longer floating over a page, it _is_ the
page. The launcher hides while the panel is open (nothing to float beside), so
the header ✕ is the only exit; the header keeps its 66px; the composer foot adds
`env(safe-area-inset-bottom)` for the home bar. **Above 480px the floating
376×640 panel at radius 20 is untouched** — pinned by a test that re-asserts the
desktop block after the media query.

Evidence — `build-11-narrow-viewport-390` (390×844 at 3×, mobile emulation) and
`build-15-narrow-closed-launcher` (the launcher still corners per config when
closed; it is only hidden while open). The frame is backed by a computed-style
read rather than a visual impression alone:

```
{"rect":[0,0,390,844],"radius":"0px","shadow":"none","border":"0px",
 "viewport":[390,844],"launcherVisible":"none"}
```

`box-shadow: none` on the full-bleed panel is a **removal, not a third
elevation** — the §4 test now counts shadow _setters_ (still exactly two, both
the canon float token) and ignores `none`. Also worth a ruling: the rule is
recorded here and in the package README, **not** folded into `CONSOLE_V3_CANON.md`
— say the word and it becomes a §7 widget carryover.

**Desktop anchoring, 2px note:** the ruling described the floating panel as
"inset-26 anchoring"; the build has always used **24** (`right: 24px`,
`bottom: 96px` = 60px launcher + 20px bottom inset + 16px gap). Since the
instruction was "applies unchanged", 24 is untouched — flagging the number in
case 26 was intended.

---

## Voice overlay — placement anchor recorded (2026-07-26, DEC-100)

`widget-voice-overlay.png` is committed as the anchor for Q-049's voice item.
**Nothing is built from it this unit** — the overlay needs a voice transport, and
a waveform that animates without a call is exactly the invented surface the repo
forbids. What lands here is the measured spec, so the unit that builds it starts
from numbers instead of a re-read.

| Region     | Measured (CSS px, ÷3 from the 3× anchor)                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surface    | panel `#FBFDFB` — **light**, confirming §7 over the retired dark surface                                                                                                                                |
| Header     | **50** tall (the chat header's 66 does not carry over) + a `#E9EEEA` hairline; 7px forest presence dot at an 18px inset, `Live voice · m:ss` in muted `#5A6660` ≈13px/700, close ✕ 11px faint `#8B968F` |
| Orb        | **90** circle, signature gradient, ✦ in ink, with a soft green halo bleeding ~12 beyond the edge                                                                                                        |
| Waveform   | **five** forest `#146B33` bars, 4 wide at a 7 pitch (32 overall), heights 9 / 11 / 17 / 22 / 24 rising to the right                                                                                     |
| Caption    | `Agent speaking…` in muted, centred under the waveform                                                                                                                                                  |
| Transcript | scrolls; eyebrow labels 11px/700 tracked — **ADA forest `#146B33`, YOU faint `#8B968F`** — above ink `#101613` body copy                                                                                |
| Foot       | a neutral white ~50 mic circle with a hairline beside a `#B0483A` hang-up circle at ~58, centred as a pair                                                                                              |

**White-label, per the brand-vs-semantic ruling:** the orb, waveform, presence dot
and the ADA eyebrow all derive from `--cfw-brand`; the **hang-up stays `#B0483A`
because danger is semantic**. That is the same split already shipped for the chat
panel, so the overlay inherits it rather than restating it.
