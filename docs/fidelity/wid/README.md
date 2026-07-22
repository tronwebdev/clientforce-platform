# §8 evidence — WID · Agent Widget embed (unit 27, DEC-096)

**Comparison basis (owner ruling 2026-07-22):** FLOW COMPOSITION is bound to
the live preview panel inside
`design_handoff_clientforce_restyle/prototypes/Agent Widget.dc.html`
(UI_PORTING_RULES screen map → "Agent Widget") and is unchanged. The VISUAL /
TOKEN layer is **Console v3 Build Spec canon** (forest `#146B33`, canon
surfaces/hairlines, Schibsted Grotesk + IBM Plex type, flat interiors) and
**intentionally diverges from the prototype's legacy skin** — so the
prototype pairs below are COMPOSITION comparisons, not pixel comparisons.
The Build Spec + owner mock files are not in-repo yet; the fidelity pass
against them is **Q-049**.

**Capture:** 1440×900 (narrow-viewport frame 390×844), dev-local Playwright
against the preinstalled Chromium; capture script lives outside the repo and
is not committed (G-fidelity discipline). **Route-interception disclosure
(the P5-W2/w3-4 precedent):** the sandbox blocks unpkg + gstatic egress from
the browser, so the prototype's React 18 UMD came from the npm registry
tarball and the Google-Fonts CSS/woff2 sets (legacy families for the
prototype page; Schibsted Grotesk + IBM Plex for the build) were prefetched
through the proxy and served locally — pixel-true assets, zero live egress
at capture. The build frames opt into `fontLoading:"google"` so the canon
faces render; the embed's DEFAULT is the system stack with zero third-party
requests.

The build pages run the real bundle (`dist/clientforce-widget.js`) on the
demo host page, whose global styles are deliberately hostile (Comic Sans
`!important`, `border-radius: 0 !important`, purple buttons — visible on the
demo's own control strip in every frame): the shadow boundary holding IS the
isolation evidence. Conversation frames are earned through the real client
seam — the visitor turn travels `WidgetTransport` → stub → reply; the stub
reply SAYS it is stubbed (no live agent exists this unit).

## Frames

| Composition pair (token layer diverges by design) | Prototype                             | Build                       |
| ------------------------------------------------- | ------------------------------------- | --------------------------- |
| Default (light, right)                            | `proto-01-design-default-light-right` | `build-02-open-panel-light` |
| Dark theme                                        | `proto-02-design-dark`                | `build-07-open-panel-dark`  |
| Position left                                     | `proto-03-design-position-left`       | `build-08-open-panel-left`  |

Build-only states (no static proto anchor — the preview is a single frame):

- `build-01-closed-launcher-right-light` — launcher + label pill (flat + hairline per canon) + unread badge
- `build-03-thinking-during-roundtrip` — motion **spin**: orb ring-spin + typing dots, mid seam round-trip
- `build-04-stub-reply-honest` — the honest stub reply + mint visitor bubble
- `build-05-agent-state-listening` — motion **ping** (border ring, no shadow)
- `build-06-agent-state-replying` — replying (**slide** entrance rides each agent row; dots visible)
- `build-09-brand-ink-auto-contrast` — brand `#101613`, auto text-on-brand flips to white
- `build-10-closed-unread-badge` — post-conversation closed state
- `build-11-narrow-viewport-390` — 300px panel centered (flagged deviation: bottom-anchored)

## Flagged deviations (all logged under DEC-096)

1. **Label pill hidden while the panel is open** — the static preview shows both; on a live page the copy would double.
2. **Messages scroll region** (max-height 342px) — the preview is static; a live thread needs a cap + scroll.
3. **Narrow viewports: bottom-anchored** — the preview's mobile frame is top-anchored inside its 560px mock; on a real page the widget stays a bottom-corner surface. Final ruling rides the mock (Q-049).
4. **Header orb letter = agent initial** (lowercase, display-face 800) — the prototype hard-codes the platform mark `f`.
5. **Typing-dots indicator** during thinking/replying — standard chat pattern, no canon anchor in the preview.
6. **Composer focus = outline ring** (flat, no box-shadow — the canon shadow rule) on `:focus-within`.
7. **Dark theme = prototype carryover** — the relayed canon is light-surface; the dark set keeps prototype literals pending the dark canon (Q-049), as do the presence dot, unread badge, and orb overlay.
8. **Motion**: canon verbs breathe/ping/spin/slide implemented; the canon's FIFTH agent state + choreography specifics reconcile when the Agent Identity & States doc lands (Q-049).
