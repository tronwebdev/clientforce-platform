# §8 evidence — WID · Agent Widget embed (unit 27, DEC-097)

**Comparison basis (owner ruling 2026-07-22):** FLOW COMPOSITION is bound to
the live-preview panel inside
`design_handoff_clientforce_restyle/prototypes/Agent Widget.dc.html`
(UI_PORTING_RULES screen map → "Agent Widget") and is unchanged. The VISUAL /
TOKEN layer is **`CONSOLE_V3_CANON.md`** (repo root, LOCKED 2026-07-12) — forest
`#146B33`, canon surfaces/hairlines, Schibsted Grotesk (Direction D), the ✦
agent mark, light-first, flat hairline interiors — and it **intentionally
diverges from the prototype's legacy skin**. The pairs below are therefore
COMPOSITION comparisons, not pixel comparisons. The remaining pass against the
`Agent Widget v3 — Mock` image (not committed) is **Q-049**.

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

- `build-01-closed-launcher-right-light` — launcher with the ✦ mark + label pill (flat + hairline) + forest unread badge
- `build-03-thinking-during-roundtrip` — motion **spin**: the mark's conic ring + typing dots, mid seam round-trip
- `build-04-stub-reply-honest` — the honest stub reply + mint visitor bubble
- `build-05-agent-state-listening` — motion **ping** (border ring)
- `build-06-agent-state-replying` — motion **slide** (sweep under the mark) + dots
- `build-09-brand-ink-auto-contrast` — brand `#101613`, auto text-on-brand flips to white
- `build-10-closed-unread-badge` — post-conversation closed state
- `build-11-narrow-viewport-390` — 300px panel centered (flagged deviation: bottom-anchored)

## Flagged deviations (all logged under DEC-097)

1. **Label pill hidden while the panel is open** — the static preview shows both; on a live page the copy would double.
2. **Messages scroll region** (max-height 342px) — the preview is static; a live thread needs a cap + scroll.
3. **Narrow viewports: bottom-anchored** — the preview's mobile frame is top-anchored inside its 560px mock; on a real page the widget stays a bottom-corner surface. Final ruling rides the mock image (Q-049).
4. **Typing-dots indicator** during thinking/replying — standard chat pattern, no canon anchor in the preview.
5. **Composer focus = outline ring** on `:focus-within` (flat — canon §4 allows no third shadow).

## Closed by canon (no longer deviations)

The kickoff's flagged prototype literals are all resolved by
`CONSOLE_V3_CANON.md` §6/§7 and are now canon, not deltas: the **✦ agent mark
on the signature gradient** (replacing the prototype's hard-coded platform mark
and the kickoff's agent-initial orb) · **forest presence dot** · **forest unread
badge with white numerals + 2px white ring** · **no dark theme** · **canon
motion verbs and timings** (and the launcher's decorative bob removed — §5 is
event-driven only). The voice overlay's canon (light `#FBFDFB`, gradient orb,
forest waveform) is recorded for the unit that builds that surface — live voice
chat is honest-absent here (Q-049).

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
