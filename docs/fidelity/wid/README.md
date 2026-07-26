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
