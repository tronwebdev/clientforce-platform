# Handoff: Clientforce — Full UI Restyle to Premium Standard

> ## ⚠️ HISTORICAL — the old-app restyle plan described here is superseded
> This README's **execution plan** (restyling the legacy `new-clientforce-ui` Nuxt 2 app — §1, §4,
> §6) is **historical**: the platform is now a greenfield build in `tronwebdev/clientforce-platform`
> (Next.js 15 + React 19), executed per the repo-root `PHASE1_HANDOFF.md` + `UI_PORTING_RULES.md` +
> `PHASE1_FIDELITY_CHECKPOINTS.md`. **Still live from this folder:** the design tokens
> (`DESIGN_TOKENS.md`, `CONSISTENCY_AUDIT.md §1–§2, §6 design decisions, §6a standards`) and the
> `prototypes/*.dc.html` files — they remain the binding design source for every screen.
> The Chrome-extension section (§5) returns in **Phase 4**.

> **For a developer or Claude Code agent working in the real repos.**
> This package is the complete spec to bring the live Clientforce app (and its Chrome extension)
> up to the prototype design — investor-grade, world-class, fully consistent.

---

## 0. Read this first
- The **design source of truth** is the set of `*.dc.html` files in this folder. They are
  **design references** — interactive HTML prototypes showing the final look + behavior. They are
  **NOT production code** and do not drop into the app. Recreate them in each target repo's own stack.
- The **engineering spec** is **`CONSISTENCY_AUDIT.md`** (in this folder). It contains the exact
  design tokens, the recurring-component catalog, the prototype→file map, the stack-translation
  rules, the locked decisions, and the global quality standards. **Read it fully before coding.**
- Fidelity: **High-fidelity.** Final colors, type, spacing, and interactions. Recreate pixel-faithfully
  using each repo's existing libraries — do not invent new visuals.

## 1. The two target repos
| Repo | Stack | What it is |
|---|---|---|
| `tronwebdev/new-clientforce-ui` | **Nuxt 2 / Vue 2**, Bootstrap 4 + bootstrap-vue, SCSS, Apollo GraphQL, Vuex | The main web app (default branch `main`) |
| `tronwebdev/clientforce-chrome` | **Vue 3 + Pinia**, Bootstrap 5, vue-router, Vue CLI / laravel-mix, `vue-remix-icons` | The Chrome/LinkedIn lead-capture extension (default branch `main`) |

Both adopt the **same design tokens and the same locked decisions** (below). They are **two separate
port tracks** because the stacks differ — do not share code across them, only the design system.

## 2. Locked decisions (non-negotiable — full detail in CONSISTENCY_AUDIT.md §6)
1. **Fonts:** Bricolage Grotesque (display) + Hanken Grotesk (body). Remove Roboto, Josefin, Plus
   Jakarta, Sora, IBM Plex. Mono = `'Courier New', ui-monospace, monospace`.
2. **Brand green:** `#35E834` as `$primary` (+ Nuxt `loading.color`). Use `#16A82A` / `#0F7A28` for
   green text on white (contrast). Signature gradient `linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)`.
3. **Modals/drawers:** restyle existing `b-modal` in place (main app) + add one shared `<AppDrawer>`
   for new right-slide panels. Extension uses its existing `reusables/ModalComponent.vue` restyled.
4. **Scope:** full restyle of every screen + the new flows. No partial phase.

## 3. Global standards (investor-grade) — apply on every screen
WCAG 2.1 AA contrast + visible focus + aria-labels + focus-trapped/Esc-closable modals + 44px targets;
responsive from 1280↓; loading (skeleton) / empty / error states on every data view, wired to the
existing Apollo/Pinia patterns; subtle motion (150–220ms, respect `prefers-reduced-motion`); **no raw
hex/px in components after the port — only tokens** (add a stylelint rule to enforce); no dead UI.
(Full list: CONSISTENCY_AUDIT.md §6a.)

## 4. Execution plan — main app (`new-clientforce-ui`)
Work **screen-by-screen, one PR each**, gated on a screenshot diff vs the matching `.dc.html`.

- **PR 1 — Foundation:** tokens → `assets/scss/_variables.scss` (+ `_tokens.scss`); set `$primary:#35E834`;
  swap fonts in `assets/scss/index.scss` + `$font-family-sans-serif`; `nuxt.config.js loading.color`.
- **PR 2 — Shared UI:** `<AppDrawer>`, button/pill/dropdown/toast/tab/stepper/toggle styles (catalog §2).
- **PR 3…N — One screen per PR** (prototype → live file, full map in §4 of the audit):
  - `Campaign View.dc.html` → `pages/campaign/_id/view.vue` + `view/{inbox,steps,people,settings,stats,logs,preview}`
  - `Create Agent.dc.html` → `pages/campaign-v2/_id/setup/index.vue`
  - `Dashboard.dc.html` → `pages/dashboardv2.vue`
  - `Agents List.dc.html` → `pages/campaigns.vue` / `campaigns-v2.vue`
  - `Analytics.dc.html` → `pages/analytics*.vue`
  - `Settings.dc.html` → credits + settings pages
  - `Contacts.dc.html`, `Forms.dc.html` → `pages/forms/_id/index.vue`, `Lead Finder.dc.html` → `pages/finder/gmb.vue`
  - `Onboarding.dc.html` → login/onboarding flow
- **PR (feature) — New flows** (real feature work, not restyle; reuse existing GraphQL/Vuex):
  per-channel step editor, "add step asks type first", editable delays, volume/limits editor,
  sender-detail drawer, lead bulk-actions + source filter, inbox sort.
- Icons: use existing `<SvgIcon name>` from `assets/icons/*.svg` (273 available) — not the prototype emoji.

## 5. Execution plan — extension (`clientforce-chrome`)
Same tokens, Vue 3 + Bootstrap 5 + Pinia. Restyle the existing shells:
- `src/App.vue`, `views/Login.vue`, `Register.vue` ← `LinkedIn Extension Popup.dc.html`
- `views/LeadsView.vue`, `SearchLeads.vue`, `AddLeads.vue`, `ActivityView.vue`, `HomeView.vue` ← `LinkedIn Extension.dc.html`
- Restyle `components/reusables/{ModalComponent,ToastNotification,LeadModal,SpinnerComponent}.vue` to the catalog.
- Add the tokens as Bootstrap 5 SCSS overrides + a `_tokens.scss`; keep Pinia stores/axios untouched.

## 6. How to run it (Claude Code)
1. Connect Claude Code to each repo (local checkout or the Claude GitHub App; `@claude` in issues/PRs).
2. Point it at this folder as the spec. Start with **PR 1 (foundation)** — review visually before proceeding.
3. Give it one screen per task; have it screenshot the rebuilt screen and diff against the `.dc.html`.
4. Review + merge each PR behind a feature flag; keep the old style switchable until full coverage.

## 7. What's in this folder
- `CONSISTENCY_AUDIT.md` — the full engineering spec (tokens, components, mapping, standards).
- `prototypes/*.dc.html` — the design references (open in a browser to view; `support.js`/`sidebar.js`
  included so they render). **Reference only.**
- `assets/` — brand logos/marks.

> A developer who wasn't in this conversation should be able to execute the whole restyle from
> `CONSISTENCY_AUDIT.md` + this README + the prototype files. If anything is ambiguous, the prototype
> HTML is the visual tie-breaker.
