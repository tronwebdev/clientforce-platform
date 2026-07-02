# Clientforce UI — Consistency Audit & Port Reference

> ## ⚠️ PARTIALLY HISTORICAL — read this box before executing anything below
> The **old-app restyle plan** in this file is superseded: the platform is now a greenfield build
> in `tronwebdev/clientforce-platform` (Next.js 15 + React 19), governed by the repo-root
> `PHASE1_HANDOFF.md`, `UI_PORTING_RULES.md`, and `PHASE1_FIDELITY_CHECKPOINTS.md`.
>
> - **Still LIVE (binding):** §1 canonical design tokens · §2 recurring component catalog ·
>   §3 internal inconsistencies · §6 locked *design* decisions (fonts, greens, gradient) ·
>   §6a global standards. Note `PHASE1_HANDOFF.md §A12`: the §1.4/§1.5 "recommended ramps" are
>   **deferred** — the prototype's literal values are the Phase-1 fidelity standard.
> - **HISTORICAL (do not execute):** §0 two-stack framing · §4 prototype→Nuxt file map ·
>   §5 Vue/Nuxt stack-translation rules · §7 automation sequence · §6's "full restyle of the old
>   app" scope decision. The Chrome-extension track returns in **Phase 4**.

> Source of truth for restyling the live app (`tronwebdev/new-clientforce-ui`) to match the
> prototypes in this project. Written for a developer or Claude Code agent to execute against
> the real repo. Scanned **18 prototype `.dc.html` files** programmatically for tokens.

---

## 0. [HISTORICAL] The headline: this is a restyle across two different stacks

| | Prototype (this project) | Live app (`new-clientforce-ui`) |
|---|---|---|
| Framework | Bespoke HTML, inline styles | **Nuxt 2 / Vue 2**, SSR off |
| UI library | none (hand-built) | **Bootstrap 4 + bootstrap-vue** (`b-modal`, `b-button`, `b-container`) |
| Styling | inline `style="…"` | **SCSS**, `assets/scss/index.scss` + scoped `<style lang="scss">` per `.vue` |
| Display font | **Bricolage Grotesque** | Roboto |
| Body font | **Hanken Grotesk** | Roboto (+ Josefin Sans, Plus Jakarta Sans loaded) |
| Primary green | **`#35E834`** | **`#0ad855`** |
| Modal radius | 16–18px | 20px (`$modal-content-border-radius`) |
| Data layer | mocked in-component | Apollo GraphQL + Vuex store |

**The prototype files are the visual spec, not deployable code.** Nothing here drops into Nuxt as-is.
The work is: lift these tokens into SCSS, then restyle each `.vue` component to match — reusing the
existing GraphQL/Vuex logic untouched.

**All four blocking decisions are now LOCKED (see §6).** Font: Bricolage + Hanken. Green: `#35E834`.
Modals: restyle `b-modal` + one shared `<AppDrawer>`. Extension: separate/net-new. Scope: full restyle.

---

## 1. Canonical design tokens (proposed — deduped from real usage)

Counts = number of occurrences across the 18 scanned files. High counts = the real system;
the long tail is drift to fold in.

### 1.1 Color — core palette (keep these as named tokens)

| Token | Hex | Uses | Role |
|---|---|---|---|
| `ink` | `#0E1512` | 1018 | primary text / near-black |
| `hairline` | `#EBE3D6` | 812 | card borders, dividers |
| `muted` | `#9AA59E` | 614 | secondary text, icons |
| `muted-2` | `#5C6B62` | 593 | body-secondary text |
| `green-ink` | `#16A82A` | 593 | legible green on white (text/icons) |
| `green` | `#35E834` | 511 | **brand primary** (vivid) |
| `cyan` | `#36D7ED` | 354 | brand secondary (gradient start) |
| `line-soft` | `#F2EEE4` | 280 | inner dividers |
| `muted-3` | `#8A7F6B` | 264 | labels / warm gray |
| `near-black` | `#0A0F0C` | 250 | text on green buttons |
| `lime` | `#D0F56B` | 212 | gradient end |
| `bg` | `#FBF7F0` | 196 | app background (warm) |
| `border-cool` | `#E4EAE6` | 174 | cool hairline variant |
| `dark` | `#0C140F` | 144 | sidebar / dark surfaces |
| `green-soft-bg` | `#D7F5DD` | 100 | success pill bg |
| `teal-ink` | `#1192A6` | 88 | cyan-on-white text |
| `danger` | `#C9543F` | 75 | destructive |
| `green-700` | `#0F7A28` | 73 | success pill text |

**Signature gradient:** `linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)`

### 1.2 Color — legitimate one-offs (keep, do NOT fold)
Provider/brand marks: `#EA4335` Gmail, `#0F6CBD`/`#0078D4` Outlook, `#0A66C2`/`#0077B5` LinkedIn,
`#34A853 #FBBC05 #4285F4` Google, `#075E54` WhatsApp, plus the macOS traffic-light dots
`#FF5F57 #FEBC2E #28C840`. These are correct.

### 1.3 Color — DRIFT to reconcile
The scan found **200+ distinct hexes**, most appearing 1–5×. The concerning clusters are
near-duplicate neutrals and greens that should collapse to the tokens above, e.g.:
- Greens: `#2FB85C #2AAD7E #5C9E6E #0E6B22 #0A3D16 #7CF59B #A8E6B6` → map to `green` / `green-ink` / `green-700`
- Warm neutrals: `#E4DFD4 #D8CFBE #E9E2D2 #ECE7DC #EFEBE2 #EDEAE2 #DBD3C5` → map to `hairline` / `line-soft`
- Cool grays: `#B7BDB6 #9AACA1 #A7AEA4 #C7D0CA #B3BBB5` → map to `muted` / `muted-2`
- Reds: `#C0533F #B0432F #C04B8A #FF5A5A #FF6B6B #F87171 #DC2626` → map to `danger`

> Action: an agent should replace each tail color with its nearest core token unless it's a
> listed provider mark. ~80% of the tail is unintentional.

### 1.4 Typography
- **Display / headings:** `Bricolage Grotesque` (324 uses) — weights 600/700/800
- **Body / UI:** `Hanken Grotesk` (81 uses) — weights 400/500/600/700
- **Mono (IPs, codes):** `Courier New` (8) → standardize to a real mono token
- ⚠️ **RESOLVED (§6.1):** `Sora` (37) and `IBM Plex Sans` (7) appear in a few files (the CLAUDE.md set).
  **Final system is Bricolage + Hanken** — the agent removes Sora/IBM Plex usages during the port.

Type scale in use (px): 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 13.5 / 14 / 15 / 16 / 16.5 / 17 / 18 / 20 / 22 / 24 / 26. Recommend collapsing to a clean ramp: **11, 12, 13, 14, 16, 18, 20, 24, 28**.

### 1.5 Radius — DRIFT (no tight scale today)
Distinct values found: `11px`(342) `12px`(207) `9px`(206) `10px`(196) `8px`(170) `14px`(115) `7px`(99) `18px`(84) `16px`(78) `13px`(62) `6px`(63) `4px` `5px` `15px` `20px` `22px` `24px` + `100px`/`999px` pills.
**Proposed scale:** `sm 8` · `md 11` · `lg 14` · `xl 16` · `2xl 20` · `pill 100`. Map the rest to nearest.

### 1.6 Shadow — DRIFT (collapse near-dupes)
| Proposed token | Value | Uses |
|---|---|---|
| `card` | `0 4px 16px rgba(14,21,18,.04)` | 109 |
| `btn-glow` | `0 6px 16px rgba(53,232,52,.26)` | 42 (fold .24/.28 variants) |
| `dropdown` | `0 16px 44px rgba(0,0,0,.18)` | 17 (fold .2 variant) |
| `drawer` | `-24px 0 70px rgba(0,0,0,.28)` | 10 |
| `modal` | `0 40px 90px rgba(0,0,0,.45)` | 17 |
| `toggle-knob` | `0 1px 3px rgba(0,0,0,.2)` | 18 |

---

## 2. Recurring component catalog
These patterns repeat across files and should become **shared Vue components**, not copied markup
(the modal-font bug we hit was a direct symptom of copy-paste duplication).

| Component | Spec | Where it appears |
|---|---|---|
| **Sidebar** | already a shared web component (`cf-sidebar` / `sidebar.js`); maps to live nav | every page |
| **Card** | `bg #fff` · `1px #EBE3D6` · radius 16 · shadow `card` | all dashboards/panels |
| **Right-slide drawer** | overlay `rgba(12,20,15,.45)` + panel `position:absolute;right:0;width:460–560` · `bg #FBF7F0/#fff` · shadow `drawer` · **must set `font-family` on overlay root** | lead detail, sender detail, step editor |
| **Center modal** | overlay + card radius 18 · shadow `modal` · sticky header+footer | volume editor, schedule |
| **Primary button** | gradient `signature` · text `#0A0F0C` · radius 11 · shadow `btn-glow` · weight 700 | every CTA |
| **Secondary button** | `#fff` · `1px #EBE3D6` · text `#5C6B62` · radius 11 | cancel/manage |
| **Ghost-green button** | text `#16A82A` · bg `rgba(53,232,52,.1)` · radius 10 | add/edit actions |
| **Status pill** | radius 7 / 100 · success `#0F7A28` on `#D7F5DD`; warn `#9A6B12` on `#FBEFD2` | senders, leads |
| **Channel chip** | per-channel bg/fg (email green, sms cyan, whatsapp lime, voice gradient) | steps, inbox |
| **Dropdown menu** | `#fff` · radius 12 · shadow `dropdown` · uppercase 10.5px header · check ✓ on active | sort, source, channel, move |
| **Toast** | `#0C140F` · `#fff` · radius 12 · centered bottom · green dot | all confirmations |
| **Tab bar** | `#fff` · `1px #EBE3D6` · radius 14 · active = ink fill | campaign view |
| **Stepper (+/−)** | round 26px buttons in pill track | volume editor, delays |
| **Toggle switch** | 44×26 track · gradient when on · `toggle-knob` shadow | settings |
| **Deliverability/score card** | bordered, gradient header, score + check rows | step editor, sender |

---

## 3. Internal inconsistencies found (fix during port)
1. **Font systems split** — Bricolage/Hanken vs Sora/IBM Plex across files (§1.4, §6.1).
2. **Color tail** — 200+ hexes; ~80% are near-dupes of 18 core tokens (§1.3).
3. **No radius scale** — 25 distinct radii; collapse to 6 (§1.5).
4. **Shadow variants** — green glow exists at .24/.26/.28; dropdown at .18/.2 — pick one each (§1.6).
5. **Duplicated drawer/modal shells** — same markup re-pasted per file; one drifted to Times serif
   because it lacked the font-root. Extract to one component.

---

## 4. [HISTORICAL] Prototype → live file map
Routes/components in the live Nuxt app line up closely with the prototype screens:

| Prototype file | Live Nuxt target |
|---|---|
| `Campaign View.dc.html` | `pages/campaign/_id/view.vue` + tabs: `view/inbox/`, `view/steps.vue`, `view/people.vue`, `view/settings.vue`, `view/stats.vue`, `view/logs.vue`, `view/preview.vue` |
| — Steps tab + step editor | `components/Campaign/CampaignStepsManager` (+ a new step-editor component) |
| `Create Agent.dc.html` | `pages/campaign-v2/_id/setup/index.vue` (35KB — the wizard) |
| `Agents List.dc.html` / `Campaigns` | `pages/campaigns.vue`, `pages/campaigns-v2.vue` |
| `Dashboard.dc.html` | `pages/dashboardv2.vue` (auth home) |
| `Analytics.dc.html` | `pages/analytics.vue`, `pages/analyticsv2.vue` |
| `Settings.dc.html` | `pages/credits.vue` + settings pages (sender mgmt) |
| `Contacts.dc.html` | contacts pages |
| `Forms.dc.html` | `pages/forms/_id/index.vue` (44KB) |
| `Lead Finder.dc.html` | `pages/finder/gmb.vue` |
| `Onboarding.dc.html` | `ONBOARDING_SETUP.md` flow + login/onboarding pages |
| `LinkedIn Extension.dc.html` | **`clientforce-chrome` repo** (Vue 3/Pinia/BS5): `src/views/LeadsView.vue`, `SearchLeads.vue`, `AddLeads.vue`, `ActivityView.vue`, `HomeView.vue` |
| `LinkedIn Extension Popup.dc.html` | `clientforce-chrome`: `src/App.vue`, `views/Login.vue`, `Register.vue`, `components/reusables/*` |
| `Integrations.dc.html` | OAuth integration pages (see `*_OAUTH_INTEGRATION_*.md`) |

> Icons: live app uses `<SvgIcon name="…">` from `assets/icons/*.svg` (273 icons). Prefer these over
> the prototype's emoji/inline glyphs when porting.

---

## 5. [HISTORICAL] Stack translation rules (for the agent)
1. **Tokens first.** Add the §1 palette/scale to `assets/scss/_variables.scss` as SCSS vars (or a
   `_tokens.scss`). Set `$primary: #35E834` (LOCKED, §6.2).
2. **Fonts:** update the `@import url(...)` in `assets/scss/index.scss` and `$font-family-sans-serif`
   in `_variables.scss` to **Bricolage Grotesque + Hanken Grotesk** (LOCKED, §6.1). Remove Roboto,
   Josefin, Plus Jakarta, Sora, IBM Plex.
3. **Inline → SCSS.** Translate prototype inline styles into scoped `<style lang="scss">` using the
   tokens. Do **not** introduce a utility framework; match the existing per-component SCSS convention.
4. **Modals/drawers:** restyle `b-modal` in place (via `modal-class`) **and** add one shared
   `<AppDrawer>` for the new right-slide panels (LOCKED, §6.3). Both match the prototype exactly.
5. **Buttons:** restyle `b-button variant="primary"` to the gradient spec rather than new elements.
6. **Don't touch logic.** GraphQL queries/mutations, Vuex actions, Apollo wiring stay as-is — this is
   styling + the few new flows only.
7. **New flows are separate tasks** (real feature work, not restyle): per-channel step editor,
   "add step asks type first", editable delays, volume/limits editor, sender-detail drawer,
   lead bulk-actions + source filter, inbox sort.

---

## 6. DECISIONS — LOCKED ✅
All four resolved. The agent treats these as non-negotiable.

**6.1 Font pair → Bricolage Grotesque (display) + Hanken Grotesk (body).** Applied everywhere.
Remove Roboto, Josefin Sans, Plus Jakarta Sans, **and** the stray Sora / IBM Plex Sans usages found
in a few prototype files. Keep one mono (`'Courier New', ui-monospace, monospace`) for codes/IPs.

**6.2 Brand green → `#35E834`.** This is `$primary` across the app. Also update `nuxt.config.js`
`loading.color: '#35E834'`. Keep `#16A82A` (green-ink) for green text/icons on white where `#35E834`
fails contrast, and `#0F7A28` for success-pill text. The signature gradient stays
`linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)`.

**6.3 Modal/drawer → “prototype style is the ultimate; best path chosen.”** Decision: restyle the
existing bootstrap-vue `b-modal` instances in place (via `modal-class`) so current flows keep their
Apollo/Vuex wiring, **and** add one shared `<AppDrawer>` Vue component for the new right-slide panels
(lead detail, sender detail, step editor). Both must visually match the prototype exactly (overlay
`rgba(12,20,15,.45)`, panel radius/shadow per §1.6, `font-family` set on the overlay root to avoid
the inherited-serif bug). No third pattern.

**6.4 Extension repo → FOUND: `tronwebdev/clientforce-chrome`.** Separate repo, **different stack**
from the main app: **Vue 3 + Pinia + Bootstrap 5 + vue-router** (Vue CLI / laravel-mix), `vue-remix-icons`.
Views map to the prototypes: `Login`, `Register`, `AddLeads`, `SearchLeads`, `LeadsView`,
`ActivityView`, `HomeView` ↔ `LinkedIn Extension*.dc.html`. Because it's Vue 3 + Bootstrap 5 + Pinia
(not Nuxt 2 + BS4 + Vuex), it is **a separate port track** with its own translation rules — but the
SAME design tokens (§1) and the SAME locked decisions (fonts, green, standards). Component shells
already exist (`reusables/ModalComponent.vue`, `ToastNotification.vue`, `LeadModal.vue`) to restyle.

**Scope → FULL restyle of every screen + the new flows, screen-by-screen PRs.** No partial phase.

---

## 6a. Global standards (investor-grade / premium SaaS)
The app must reach a world-class bar as part of this update, not just match the mockups visually.
The agent applies these across every screen it touches:

- **Accessibility:** WCAG 2.1 AA. Text contrast ≥ 4.5:1 (use `#16A82A`/`#0F7A28` for green text on
  white, never `#35E834`). Visible focus rings on all interactive elements. All icon-only buttons get
  `aria-label`. Modals/drawers trap focus, close on Esc, and restore focus on close. Hit targets ≥ 44px.
- **Responsive:** every screen works from 1280→small laptop; the existing `$container-max-widths`
  breakpoints are respected. No fixed-px layouts that overflow.
- **States everywhere:** loading (skeletons, not just spinners), empty, and error states for every
  data-backed view — wired to the existing Apollo `loading`/error patterns.
- **Motion:** consistent, subtle (150–220ms ease), respect `prefers-reduced-motion`.
- **Consistency enforced by tokens:** no raw hex/px in components after the port — only SCSS tokens
  from §1. Add a stylelint rule to fail on off-token colors.
- **Performance:** no regressions to bundle size; lazy-load heavy routes; keep Apollo cache behavior.
- **No dead UI:** every button/link wired or explicitly disabled with reason. (We already did this
  pass in the prototypes — carry it into the real app.)

---

## 7. [HISTORICAL] Recommended automation sequence (Claude Code, in-repo)
1. **PR 1 — tokens & fonts:** update `_variables.scss` + `index.scss`. Visual smoke-test. *(foundation; do first)*
2. **PR 2 — shared components:** `<AppDrawer>`, button/pill/dropdown/toast styles. 
3. **PR 3…N — one screen per PR:** restyle each `.vue` against its prototype; screenshot-diff vs the
   `.dc.html`; self-correct.
4. **PR (feature) — new flows:** §5.7 items, each with its own review.
5. Gate every PR on a visual-regression screenshot compare; merge screen-by-screen behind a flag.

> This file is designed to be handed to Claude Code as the spec. Pair it with the prototype
> `.dc.html` files (visual reference) and the live repo (target).
