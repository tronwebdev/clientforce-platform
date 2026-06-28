# Clientforce Platform — Canonical Design Tokens

> **Source of truth for `packages/ui` (T5) and all platform UI.** Derived from the prototype
> consistency audit (`CONSISTENCY_AUDIT.md`), which programmatically scanned 18 prototype screens.
> These are **canonical — do not invent or rename.** Build the `packages/ui` theme directly from
> the names + values below. The platform UI is **React** (Next.js), so express these as a theme
> object / CSS custom properties — not SCSS. (The audit's §5 SCSS rules describe the *legacy* Nuxt
> app and don't apply to the greenfield platform.)

---

## 1. Color tokens (named — keep exactly)

| Token | Hex | Role |
|---|---|---|
| `ink` | `#0E1512` | primary text / near-black |
| `hairline` | `#EBE3D6` | card borders, dividers |
| `muted` | `#9AA59E` | secondary text, icons |
| `muted-2` | `#5C6B62` | body-secondary text |
| `green-ink` | `#16A82A` | **legible green on white** (text/icons) |
| `green` | `#35E834` | **brand primary** (vivid) |
| `cyan` | `#36D7ED` | brand secondary (gradient start) |
| `line-soft` | `#F2EEE4` | inner dividers |
| `muted-3` | `#8A7F6B` | labels / warm gray |
| `near-black` | `#0A0F0C` | text on green buttons |
| `lime` | `#D0F56B` | gradient end |
| `bg` | `#FBF7F0` | app background (warm) |
| `border-cool` | `#E4EAE6` | cool hairline variant |
| `dark` | `#0C140F` | sidebar / dark surfaces |
| `green-soft-bg` | `#D7F5DD` | success pill bg |
| `teal-ink` | `#1192A6` | cyan-on-white text |
| `danger` | `#C9543F` | destructive |
| `green-700` | `#0F7A28` | success pill text |
| `surface` | `#FFFFFF` | cards, panels |

**Signature gradient** (token `gradient-brand`):
`linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)`

### Provider/brand marks — legitimate one-offs, keep as-is, never fold into tokens
Gmail `#EA4335` · Outlook `#0F6CBD` `#0078D4` · LinkedIn `#0A66C2` `#0077B5` ·
Google `#34A853` `#FBBC05` `#4285F4` · WhatsApp `#075E54` · macOS dots `#FF5F57` `#FEBC2E` `#28C840`.

### Contrast rule (WCAG AA — non-negotiable)
`#35E834` (`green`) **fails** 4.5:1 on white — use it only for fills/accents, **never green text on
white**. For green text/icons on white use `green-ink` (`#16A82A`); for success-pill text use
`green-700` (`#0F7A28`).

---

## 2. Typography
- **Display / headings:** `Bricolage Grotesque` — weights 600 / 700 / 800
- **Body / UI:** `Hanken Grotesk` — weights 400 / 500 / 600 / 700
- **Mono (IPs, codes):** `'Courier New', ui-monospace, monospace`
- Do **not** use Roboto, Josefin Sans, Plus Jakarta Sans, Sora, or IBM Plex Sans.
- **Type ramp (px):** `11 · 12 · 13 · 14 · 16 · 18 · 20 · 24 · 28` (collapse any other size to nearest)

---

## 3. Radius scale
| Token | px |
|---|---|
| `sm` | 8 |
| `md` | 11 |
| `lg` | 14 |
| `xl` | 16 |
| `2xl` | 20 |
| `pill` | 100 |

---

## 4. Shadow tokens
| Token | Value |
|---|---|
| `card` | `0 4px 16px rgba(14,21,18,.04)` |
| `btn-glow` | `0 6px 16px rgba(53,232,52,.26)` |
| `dropdown` | `0 16px 44px rgba(0,0,0,.18)` |
| `drawer` | `-24px 0 70px rgba(0,0,0,.28)` |
| `modal` | `0 40px 90px rgba(0,0,0,.45)` |
| `toggle-knob` | `0 1px 3px rgba(0,0,0,.2)` |

---

## 5. Spacing
Use a 4px base ramp: `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48`. Component internal padding in the
prototypes clusters at 10–16px; default card/panel padding = 16–22px.

---

## 6. Base component specs (build these in T5)

| Component | Spec |
|---|---|
| **Button / primary** | bg `gradient-brand` · text `near-black` (`#0A0F0C`) · radius `md` (11) · shadow `btn-glow` · weight 700 |
| **Button / secondary** | bg `surface` · `1px hairline` · text `muted-2` · radius `md` |
| **Button / ghost-green** | text `green-ink` · bg `rgba(53,232,52,.1)` · radius 10 |
| **Card** | bg `surface` · `1px hairline` · radius `xl` (16) · shadow `card` |
| **Pill / status** | radius `pill` (or 7 for square-ish) · success = `green-700` on `green-soft-bg`; warn = `#9A6B12` on `#FBEFD2` |
| **Channel chip** | per-channel: email→green, sms→cyan, whatsapp→lime, voice→`gradient-brand` |
| **Dropdown menu** | bg `surface` · radius `lg` (12–14) · shadow `dropdown` · 10.5px uppercase header · ✓ on active row |
| **Toast** | bg `dark` (`#0C140F`) · text `surface` · radius `lg` · centered bottom · leading green dot |
| **Tab bar** | bg `surface` · `1px hairline` · radius `lg` (14) · active = `ink` fill, white text |
| **Toggle** | 44×26 track · `gradient-brand` when on · knob shadow `toggle-knob` |
| **Drawer (right-slide)** | overlay `rgba(12,20,15,.45)` · panel `right:0; width:460–560` · bg `bg`/`surface` · shadow `drawer` · **set `font-family` on the overlay root** (prevents inherited-serif bug) · trap focus, close on Esc, restore focus |
| **Modal (center)** | overlay + card radius `xl`/18 · shadow `modal` · sticky header + footer · focus-trapped |

---

## 7. Global standards (apply in every component)
- **Accessibility (WCAG 2.1 AA):** contrast ≥ 4.5:1 (green text → `green-ink`/`green-700`, never
  `green`); visible focus rings; `aria-label` on icon-only buttons; modals/drawers trap focus, close
  on Esc, restore focus; hit targets ≥ 44px.
- **States:** every data-backed view has loading (skeleton), empty, and error states.
- **Motion:** 150–220ms ease; respect `prefers-reduced-motion`.
- **Token discipline:** no raw hex/px in components — only these tokens. Stylelint must fail on
  off-token colors (the T0 lint rule).

---

### For T5 specifically
Build `packages/ui` as: (1) a theme object exporting all of §1–§5 by these exact token names, wired
to CSS custom properties; (2) the §6 base components (Button, Card, Pill, Dropdown, Toast, Tab,
Toggle — Drawer/Modal can land in T6 or here); (3) a Storybook (or sample route) rendering them, with
a screenshot for visual-match review. On-token only; stylelint green.
