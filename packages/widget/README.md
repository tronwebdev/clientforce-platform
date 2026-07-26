# @clientforce/widget — embeddable Agent Widget

Drop-in `<script>` embed that mounts the Agent Widget on any host page with
**shadow-DOM isolation** (host styles cannot reach in; widget styles cannot
leak out). First reference implementation of the **console-v3** language —
all atoms come from `@clientforce/theme` (`--cv3-*`), the typed mirror of
`CONSOLE_V3_CANON.md` at the repo root — forest `#146B33`, Schibsted Grotesk
type, light-first, flat hairline interiors;
flow composition is ported from the Agent Widget prototype's live-preview
panel (`design_handoff_clientforce_restyle/prototypes/Agent Widget.dc.html`)
— per the owner's 2026-07-22 review, only the visual/token layer moves to
canon; composition stays the prototype's.

**This unit ships no backend.** The API seam below is fully typed and
exercised by the client, but the default transport is an honest stub: every
stub reply says it is stubbed, and `meta.stub: true` marks every response.

---

## 1. Embed snippet contract

Canonical drop-in (the prototype Install-tab shape, verbatim):

```html
<script src="https://cdn.clientforce.co/widget.js" data-widget-id="wgt_8fa3c21e" async></script>
```

`data-widget-id` is the only required attribute. The build artifact is
`dist/clientforce-widget.js` (self-contained IIFE, no runtime deps, CSS
inlined); the CDN path/filename is a deploy concern for the wiring unit.

Optional data-attributes (all have prototype defaults):

| Attribute                                                                                                       | Values                                                | Default                                                                               |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `data-agent-id` / `data-campaign-id`                                                                            | ids                                                   | — (preview/dev override; the server's `widgetId` mapping is authoritative once wired) |
| `data-api-base`                                                                                                 | origin                                                | — (absent ⇒ stubbed transport)                                                        |
| `data-business-name`                                                                                            | text                                                  | — (names the tenant in the welcome copy + subtitle)                                   |
| `data-agent-name`                                                                                               | text                                                  | `Ada` (canon §6 default)                                                              |
| `data-brand-color`                                                                                              | `#rgb`/`#rrggbb`                                      | `#146b33` (canon forest accent)                                                       |
| `data-text-on-brand`                                                                                            | color or omit                                         | auto (prototype luminance rule)                                                       |
| `data-launcher-text`                                                                                            | text                                                  | `Chat with our AI Sales Agent`                                                        |
| `data-subtitle`                                                                                                 | text                                                  | `AI Sales Assistant`                                                                  |
| `data-welcome-message`                                                                                          | text                                                  | derived canon copy (see §2) — emoji-free                                              |
| `data-corner`                                                                                                   | `xl` \| `l` \| `m` \| `s` \| `none` (22/20/12/9/0 px) | `l` (= the owner's panel radius 20)                                                   |
| `data-position`                                                                                                 | `left` \| `right`                                     | `right`                                                                               |
| `data-unread-badge`                                                                                             | `true` \| `false`                                     | `true`                                                                                |
| `data-open-after`                                                                                               | seconds \| `off`                                      | `4`                                                                                   |
| `data-exit-intent`                                                                                              | `true` \| `false`                                     | `false`                                                                               |
| `data-flow-book-visit` / `-call-me-back` / `-schedule-callback` / `-estimate` / `-live-voice` / `-ask-question` | `false` to disable                                    | all on (workspace-level, ungated)                                                     |
| `data-z-index`                                                                                                  | number                                                | `2147483000`                                                                          |
| `data-font-loading`                                                                                             | `none` \| `google`                                    | `none` (the embed makes **zero** third-party requests by default)                     |

Programmatic control — the pre-load command queue (safe to call before the
bundle loads; replayed in order):

```html
<script>
  window.ClientforceWidget =
    window.ClientforceWidget ||
    function () {
      (window.ClientforceWidget.q = window.ClientforceWidget.q || []).push(arguments);
    };
  ClientforceWidget("init", { widgetId: "wgt_8fa3c21e", appearance: { position: "left" } });
  ClientforceWidget("on", "ready", (info) => console.log("widget ready", info));
</script>
<script src="https://cdn.clientforce.co/widget.js" async></script>
```

Commands: `init` · `open` · `close` · `toggle` · `send` · `update` ·
`setAgentState` (preview/dev) · `on` / `off` · `destroy`. An explicit queued
`init` wins over the script tag's data-attributes; one instance per page
(repeat `init` warns; `destroy` releases the page for re-init).

Events: `ready` · `open` · `close` · `message:sent` · `message:received` ·
`agent:state` · `error` · `destroy`.

## 2. Panel anatomy — measured off `docs/fidelity/wid/widget-panel-canon.png`

The accent **never paints a surface**. Panel 376×640 at radius 20 inside a 1px
`line` border, the float shadow being the one canon exception. Header 66px on
`panel` with a `line` hairline bottom: the ✦ agent mark as a 38px tile at radius
11 on the signature gradient (inset 16/14), name in ink 800/15.5px, subtitle in
muted behind a 7px forest presence dot, close an 11px ✕ in faint. Thread on
`card`, scrolling; composer + platform line pinned to a `panel` foot band.
Composer is a **48px white pill** with a `line-input` hairline — 16px text
inset, a 34px white mic circle, a 32px accent send circle, 8px apart, 12px
inset from the panel — and its focus ring appears on interaction only (opening
moves focus to the panel, not the field, so no ring is ever parked). Agent
bubbles are `bubble-agent` with a `5px 14px 14px 14px` notch pointing at the
26px message mark and run the full row width; visitor bubbles are ink with
panel-tone text at `14px 14px 4px 14px`, capped at 82%. Entry chips are 32px
pills (`0 14px`, `line-soft` hairline, muted label; the first active flow takes
mint + accent), indented to the bubble's left edge. Every panel carries
**Powered by Clientforce Ai** at the foot (10.5px faint, behind an 11px gradient
square).

All four questions the measuring raised are ruled (owner, 2026-07-26; recorded
in the §8 report): the composer **pill** wins over the written radius 15 and
canon §4 was amended rather than the build, **640** ships (the mock's 592 is the
demo viewport clamping `max-height`), **canon type** ships (atoms follow the
token doc, composition follows the mock), and the greens split by MEANING —
decorative/brand green derives from the accent (presence dot, entry-chip fill),
while semantic green stays canon (outcome confirmations are green because they
mean _good_).

## 3. Flows, appearance, and white-label — two separate layers

**Workspace-level and ungated** (any workspace configures this in widget setup,
no plan check): the accent color — `--cfw-brand`, which defaults to canon forest
and paints the send circle, presence dot, unread badge, primary-chip label and
fill, and focus rings, so a workspace's own accent actually reaches the panel
(`--cfw-brand-tint` carries canon mint verbatim for the canon accent, so the
default panel is byte-identical to the mock) — the logo/mark, and **which of the
six flows are enabled** — Book a visit · Call me back · Schedule callback · Get an
estimate · Live voice (rides the composer mic) · Ask a question. Industries use
different subsets, so the panel renders **only the active flows** and never a
placeholder for a disabled one. Labels stay server-offered per tenant; the
client draws the icon from the flow `kind`.

**Plan-gated (agency tier only):** suppressing the **Powered by Clientforce Ai**
line. It is default-on for every workspace and is **not** workspace-
configurable — the only thing that can switch it off is the server's plan check,
delivered as `branding.platformAttribution: false` on the session response.
There is deliberately **no data-attribute and no init option** for it, so a host
page cannot strip the attribution (canon §7; pinned by test).

## 4. Isolation contract

- One host element (`#clientforce-widget-host`) appended to `<body>`; ALL
  markup and styles live in its open shadow root (`:host { all: initial }`,
  token sheet scoped `:root, :host`).
- The host document is never touched beyond that element — except the
  **opt-in** `fontLoading: "google"` font `<link>` (fonts cannot be loaded
  from inside a shadow root).
- `--cv3-*` tokens + `--cfw-*` instance vars; zero collision with host CSS or
  the legacy `--cf-*` skin.
- **Light-first:** canon §7 states there is no dark canon, so the embed ships
  no dark theme — `theme:"dark"` warns and renders light rather than shipping
  an un-canon'd skin.
- **Narrow viewports (owner rule, 2026-07-26):** below **480px** the panel goes
  **full-bleed** — `inset: 0`, radius 0, full width and height, no float shadow.
  It is no longer floating over a page, it _is_ the page. The launcher hides
  while the panel is open (nothing to float beside), so the header ✕ is the only
  exit; the header keeps its 66px, and the composer foot adds
  `env(safe-area-inset-bottom)` for the home bar. Above 480px the floating
  376×640 panel at radius 20 applies unchanged. Pinned by test in both
  directions.

## 5. API seam — ONE documented endpoint (stubbed this unit)

```
POST {apiBase}/widget/v1/session
```

Public, unauthenticated-but-keyed rail: the page carries only the `wgt_…`
public id; the server resolves it to workspace/agent/campaign, so **no tenant
identifier ever reaches the host page**. Every interaction is one request
with a discriminated `event`; the response carries the messages to append.
Types of record: `src/api/contract.ts` (`WidgetSessionRequest` /
`WidgetSessionResponse`, `contractVersion: 1`).

Request:

```jsonc
{
  "contractVersion": 1,
  "widgetId": "wgt_8fa3c21e",
  "sessionId": null, // null on boot → server mints one
  "agentId": null, // preview/dev override only
  "campaignId": null, // preview/dev override only
  "event": { "type": "visitor_message", "text": "What does it cost?" },
  // event union: boot | open | close | visitor_message{text}
  //            | quick_action{action: book_call|call_me_back|get_proposal}
  //            | capture_submit{fields}
  "context": { "pageUrl": "https://host.example/pricing", "locale": "en-US" },
}
```

Response:

```jsonc
{
  "contractVersion": 1,
  "sessionId": "sess_9f2…",
  "agent": { "name": "Acme Sales Agent", "subtitle": "AI Sales Assistant", "state": "replying" },
  "messages": [
    // DELTA to append, not the transcript
    { "id": "msg_…", "role": "agent", "text": "…", "at": "2026-07-22T12:00:00Z" },
  ],
  "quickActions": [
    // client masks these against feature config
    { "kind": "book_call", "label": "📅 Book a call" },
  ],
  "appearance": null, // server-resolved config once the builder exists
  "meta": { "stub": false },
}
```

Transport seam: `WidgetTransport.send(req)` — `StubTransport` (default, no
`apiBase`) and `HttpTransport` (the fetch shape the wiring unit takes over).

**Wiring-unit promotion path (documented default):** these shapes move to zod
DTOs in `@clientforce/core` (repo convention) when the NestJS `widget` module
lands; that unit also registers the `widget.*` event-catalog entries and the
`widget_chat_started` automation trigger (Q-035) once real producers exist —
nothing is registered now because nothing fires now.

## 6. Console-v3 shell

Composition ported from the prototype preview: 60px launcher (float loop,
unread badge, label pill) + 344px panel — brand header with the
agent-identity orb, presence dot, thread bubbles (asymmetric-corner radius),
quick-action chips, pill composer with mic + send. Light/dark themes, corner
and position options per the builder's Design tab.

Agent-identity motion (canon §5/§6) runs on the ✦ mark: idle→**breathe** ·
listening→**ping** (border ring) · thinking→**spin** (conic ring) ·
replying→**slide** (a sweep under the mark) + typing dots — CSS-driven off
`data-agent-state`, canon timings, all disabled under
`prefers-reduced-motion`. The widget keeps exactly these FOUR chat verbs;
canon §6 forbids forcing a fifth. They map into the five console states via
`WIDGET_STATE_TO_CONSOLE` in `@clientforce/theme` (`needs-you` and `held` are
console-surface states with no widget analogue).

## 7. Develop

```
pnpm --filter @clientforce/widget build   # typecheck + esbuild IIFE → dist/
pnpm --filter @clientforce/widget test    # vitest (jsdom)
```

`demo/index.html` is a hostile host page (clashing global styles) that loads
the built bundle — open it after a build to see isolation + the full shell.
