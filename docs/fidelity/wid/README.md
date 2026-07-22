# §8 evidence — WID · Agent Widget embed (unit 27 kickoff, DEC-094)

**Comparison basis:** the widget's binding composition source is the **live
preview panel** inside `design_handoff_clientforce_restyle/prototypes/Agent
Widget.dc.html` (UI_PORTING_RULES screen map → "Agent Widget"). The owner's
console-v3 mock had not arrived at capture time — **it supersedes this set on
arrival; a final fidelity pass is queued (Q-047)**. Atoms are console-v3
tokens (`@clientforce/theme`), which are canon-derived only.

**Capture:** 1440×900 (narrow-viewport frame 390×844), dev-local Playwright
against the preinstalled Chromium; capture script lives outside the repo and
is not committed (G-fidelity discipline). **Route-interception disclosure
(the P5-W2/w3-4 precedent):** the sandbox blocks unpkg + gstatic egress from
the browser, so the prototype's React 18 UMD came from the npm registry
tarball and both Google-Fonts CSS/woff2 sets were prefetched through the
proxy and served locally — pixel-true assets, zero live egress at capture.
The build frames opt into `fontLoading:"google"` for typographic parity with
the prototype; the embed's DEFAULT is the system stack with zero third-party
requests.

The build pages run the real bundle (`dist/clientforce-widget.js`) on the
demo host page, whose global styles are deliberately hostile (Comic Sans
`!important`, `border-radius: 0 !important`, purple buttons — visible on the
demo's own control strip in every frame): the shadow boundary holding IS the
isolation evidence. Conversation frames are earned through the real client
seam — the visitor turn travels `WidgetTransport` → stub → reply; the stub
reply SAYS it is stubbed (no live agent exists this unit).

## Frames

| Pair                                 | Prototype                             | Build                       |
| ------------------------------------ | ------------------------------------- | --------------------------- |
| Default (light, right, forest brand) | `proto-01-design-default-light-right` | `build-02-open-panel-light` |
| Dark theme                           | `proto-02-design-dark`                | `build-07-open-panel-dark`  |
| Position left                        | `proto-03-design-position-left`       | `build-08-open-panel-left`  |

Build-only states (no static proto anchor — the preview is a single frame):

- `build-01-closed-launcher-right-light` — launcher + label pill + unread badge (canon closed state)
- `build-03-thinking-during-roundtrip` — motion state **thinking**: orb ring-spin + typing dots, mid seam round-trip
- `build-04-stub-reply-honest` — the honest stub reply + visitor bubble (conversations-canon style)
- `build-05/06-agent-state-listening/replying` — remaining motion states (idle is the default in every open frame)
- `build-09-brand-ink-auto-contrast` — brand `#0E1512`, auto text-on-brand flips to white (prototype `ink()` rule)
- `build-10-closed-unread-badge` — post-conversation closed state
- `build-11-narrow-viewport-390` — 300px panel centered (flagged deviation: bottom-anchored)

## Flagged deviations (all logged under DEC-094)

1. **Label pill hidden while the panel is open** — the static preview shows both; on a live page the copy would double.
2. **Messages scroll region** (max-height 342px) — the preview is static; a live thread needs a cap + scroll.
3. **Narrow viewports: bottom-anchored** — the preview's mobile frame is top-anchored inside its 560px mock; on a real page the widget stays a bottom-corner surface. Final ruling rides the mock.
4. **Header orb letter = agent initial** (lowercase, Bricolage 800 — canon type treatment) — the prototype hard-codes the platform mark `f`.
5. **Typing-dots indicator** during thinking/replying — standard chat pattern, no canon anchor in the preview.
6. **Composer focus ring** — visible focus moved from the input rectangle to a `focus-within` ring on the pill composer (WCAG §7 visible-focus kept, hairline language).
7. **Atom conflicts, token doc wins (logged, not silently chosen):** danger `#C9543F` (prototype widget uses `#C0584B` in places; the embed renders no danger surface today) · `btn-glow` alpha .26 per DESIGN_TOKENS (prototype CTA uses .28; unused in the embed).
8. **Motion-state choreography provisional** (breath / ripple / ring-spin / quick-breath) pending the mock — Q-047.
