# UI Porting Rules — read before any UI ticket

> **Binding rule for every screen/component ticket (T5, T6, and all of Phase 1+).**
> Add the relevant line of this file to each UI issue. It exists because T6 reconstructed the
> sidebar from tokens + screenshots instead of porting the source, and shipped the wrong
> Tools behavior + badge colors. Don't repeat that.

## The rule

**Port from the prototype file. Do not reconstruct from tokens, memory, or screenshots.**

For any screen or component, the **binding source of truth is the matching prototype**:
`design_handoff_clientforce_restyle/prototypes/<Screen>.dc.html` (and the shared
`prototypes/sidebar.js`). Read that file and match its **structure, states, interactions, exact
colors, spacing, and copy** — translating Design-Component (DC) markup → React, but **not
redesigning** anything.

`DESIGN_TOKENS.md` defines the *atomic* system (colors, type, radii, shadows, per-component specs).
It does **not** describe *composed* behavior — flyouts, drawers, bulk-action bars, sequence editors,
empty/loading states. Those live **only inside the prototype `.dc.html` files**. Use tokens for the
atoms; use the prototype for the composition.

## What "port, don't reconstruct" means concretely
- Open the prototype file first; mirror its DOM hierarchy and the logic in its `renderVals()`.
- Keep every interaction: open/close wiring, hover/active states, chevron flips, close-on-outside-click, single-open dropdowns, toasts, focus traps.
- Lift exact hex/px/gradient values from the prototype, not from approximations.
- Match copy verbatim (labels, badges, empty-state text).
- Reproduce all states the prototype has: default, loading/skeleton, empty, error, selected.
- If the prototype and `DESIGN_TOKENS.md` ever conflict on an atom (a color/radius), the **token doc wins** for that atom — but flag the conflict in the PR rather than silently choosing.

## Screen → prototype map (Phase 1+)
| Area | Binding prototype |
|---|---|
| Sidebar / nav (all screens) | `prototypes/sidebar.js` |
| Dashboard | `prototypes/Dashboard.dc.html` |
| Agents list | `prototypes/Agents List.dc.html` |
| Create / edit agent | `prototypes/Create Agent.dc.html` |
| Campaign view (inbox/steps/leads/settings) | `prototypes/Campaign View.dc.html` |
| Contacts | `prototypes/Contacts.dc.html` |
| Lead Finder (+ Auto Prospecting) | `prototypes/Lead Finder.dc.html` |
| Proposals | `prototypes/Proposals.dc.html` |
| Forms | `prototypes/Forms.dc.html` |
| Agent Widget | `prototypes/Agent Widget.dc.html` |
| Integrations | `prototypes/Integrations.dc.html` |
| Automations | `prototypes/Automations.dc.html` |
| Analytics / Stats | `prototypes/Analytics.dc.html` |
| Settings | `prototypes/Settings.dc.html` |
| Account / workspaces / billing | `prototypes/Account Admin.dc.html` |
| LinkedIn extension | `prototypes/LinkedIn Extension.dc.html` |
| Onboarding | `prototypes/Onboarding.dc.html` |

## Review gate
Every UI PR ships with a screenshot (and, for stateful UI, screenshots of each state — e.g. the
**closed** rail *and* the **open** flyout). Reviewer holds the merge until the screenshot matches the
prototype 1:1. This gate is what caught the T6 sidebar slip — keep it.
