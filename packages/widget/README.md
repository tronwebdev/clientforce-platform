# @clientforce/widget — embeddable Agent Widget

Drop-in `<script>` embed that mounts the Agent Widget on any host page with
**shadow-DOM isolation** (host styles cannot reach in; widget styles cannot
leak out). First reference implementation of the **console-v3** language —
all atoms come from `@clientforce/theme` (`--cv3-*`); composition is ported
from the Agent Widget prototype's live-preview panel
(`design_handoff_clientforce_restyle/prototypes/Agent Widget.dc.html`).

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

| Attribute                                                                | Values                                                | Default                                                                               |
| ------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `data-agent-id` / `data-campaign-id`                                     | ids                                                   | — (preview/dev override; the server's `widgetId` mapping is authoritative once wired) |
| `data-api-base`                                                          | origin                                                | — (absent ⇒ stubbed transport)                                                        |
| `data-agent-name`                                                        | text                                                  | `AI Sales Agent`                                                                      |
| `data-brand-color`                                                       | `#rgb`/`#rrggbb`                                      | `#16a82a` (console-v3 forest accent)                                                  |
| `data-text-on-brand`                                                     | color or omit                                         | auto (prototype luminance rule)                                                       |
| `data-launcher-text`                                                     | text                                                  | `Chat with our AI Sales Agent`                                                        |
| `data-subtitle`                                                          | text                                                  | `AI Sales Assistant`                                                                  |
| `data-welcome-message`                                                   | text                                                  | `Hi! 👋 How can I help?`                                                              |
| `data-theme`                                                             | `light` \| `dark`                                     | `light`                                                                               |
| `data-corner`                                                            | `xl` \| `l` \| `m` \| `s` \| `none` (28/20/14/8/0 px) | `l`                                                                                   |
| `data-position`                                                          | `left` \| `right`                                     | `right`                                                                               |
| `data-unread-badge`                                                      | `true` \| `false`                                     | `true`                                                                                |
| `data-open-after`                                                        | seconds \| `off`                                      | `4`                                                                                   |
| `data-exit-intent`                                                       | `true` \| `false`                                     | `false`                                                                               |
| `data-feature-book-call` / `-call-me-back` / `-voice-chat` / `-proposal` | `false` to disable                                    | all on                                                                                |
| `data-z-index`                                                           | number                                                | `2147483000`                                                                          |
| `data-font-loading`                                                      | `none` \| `google`                                    | `none` (the embed makes **zero** third-party requests by default)                     |

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

## 2. Isolation contract

- One host element (`#clientforce-widget-host`) appended to `<body>`; ALL
  markup and styles live in its open shadow root (`:host { all: initial }`,
  token sheet scoped `:root, :host`).
- The host document is never touched beyond that element — except the
  **opt-in** `fontLoading: "google"` font `<link>` (fonts cannot be loaded
  from inside a shadow root).
- `--cv3-*` tokens + `--cfw-*` instance vars; zero collision with host CSS or
  the legacy `--cf-*` skin.

## 3. API seam — ONE documented endpoint (stubbed this unit)

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

## 4. Console-v3 shell

Composition ported from the prototype preview: 60px launcher (float loop,
unread badge, label pill) + 344px panel — brand header with the
agent-identity orb, presence dot, thread bubbles (asymmetric-corner radius),
quick-action chips, pill composer with mic + send. Light/dark themes, corner
and position options per the builder's Design tab.

Agent-identity motion states (`idle | listening | thinking | replying`) run
on the identity orb — breath / ripple / ring-spin / quick-breath + typing
dots — CSS-driven off `data-agent-state`, disabled under
`prefers-reduced-motion`. Choreography is provisional pending the owner's
console-v3 mock (Q-047), as is the final visual pass.

## 5. Develop

```
pnpm --filter @clientforce/widget build   # typecheck + esbuild IIFE → dist/
pnpm --filter @clientforce/widget test    # vitest (jsdom)
```

`demo/index.html` is a hostile host page (clashing global styles) that loads
the built bundle — open it after a build to see isolation + the full shell.
