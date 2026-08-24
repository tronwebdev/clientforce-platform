# UPLOAD & DISPATCH INSTRUCTIONS — Console Bold port
Follow top to bottom. Two uploads, one commit, one message to Claude Code. Nothing else.

---

## STEP 1 — Upload the package folder into the repo

**What:** the entire `design_handoff_console_v3/` folder from the zip (all 16 docs/prompts + `prototypes/` with 8 files + `prototypes/legacy/`).

**Where:** the ROOT of `tronwebdev/clientforce-platform`, on `main`, so the repo gains:

```
clientforce-platform/
  design_handoff_console_v3/          ← NEW (sits beside design_handoff_clientforce_restyle/)
    README.md
    ADDENDUM_2_CREDITS_VALUE.md
    ADDENDUM_3_ADS_LOOP_UI.md
    ADDENDUM_4_BOLD.md
    BACKEND_TOUCH_MAP.md
    CONSOLE_V3_BUILD_NOTES.md
    CONSOLE_V3_CANON.md
    DECISION_LOG_BOLD.md
    DESIGN_TOKENS_V3.md
    MIGRATION_NON_BREAKING.md
    SURFACE_SPECS.md
    SURFACE_SPECS_BOLD.md
    PROMPT_BOLD_PORT_KICKOFF.md
    PROMPT_V3_PORT_KICKOFF.md         (superseded — kept for history)
    PROMPT_V3_W0_W1_KICKOFF.md        (superseded — kept for history)
    PROMPT_V3_W11_ADS_LOOP_KICKOFF.md (still live — it IS wave B11)
    prototypes/
      Console Bold.dc.html            ← THE console pixel truth
      Agent Widget v3 - Mock.dc.html
      Business Core Onboarding.dc.html
      Clientforce Account.dc.html
      Clientforce Agency Website.dc.html
      Clientforce Client Portal.dc.html
      Onboarding.dc.html
      support.js                      ← must sit beside the .dc.html files or they won't open
      legacy/
        Clientforce Console.dc.html   ← retired v3 console, reference only
```

**Do NOT** rename anything, move files up a level, or merge into the old `design_handoff_clientforce_restyle/` folder — the kickoff prompt references these exact paths.

**Commit message:**
```
docs: land design_handoff_console_v3 (Console Bold port package, B0–B11)
```

**Also add one entry to PROGRESS.md** (top of the log, no DEC id needed):
```
2026-08-23 — design_handoff_console_v3/ landed at repo root. Console rebuilt as
Console Bold (prototypes/Console Bold.dc.html = pixel truth; legacy v3 console
retired to prototypes/legacy/). Port waves B0–B11 defined in ADDENDUM_4_BOLD.md;
dispatch prompt = PROMPT_BOLD_PORT_KICKOFF.md. No code changes in this commit.
```

---

## STEP 2 — Send the kickoff to Claude Code

**After** Step 1 is pushed (the prompt tells Claude Code to read files that must already be in the repo).

**What to send:** the full contents of `PROMPT_BOLD_PORT_KICKOFF.md`, verbatim, as one message. Add this one line above it:

```
The package it references is now committed at design_handoff_console_v3/.
Start with wave B0 only — stop after the B0 PR is open.
```

**Do NOT send:** any other prompt file. `PROMPT_V3_PORT_KICKOFF.md` and `PROMPT_V3_W0_W1_KICKOFF.md` are superseded. `PROMPT_V3_W11_ADS_LOOP_KICKOFF.md` is sent later, only when wave B11 starts.

---

## STEP 3 — What comes back, and when you ping me

Claude Code should open **one PR per wave**, in order:

| Wave | What you'll see | Flag |
|---|---|---|
| B0 | tokens + 3-column shell, rail, dock, Ada bar | consoleBold |
| B1 | campaign console (rail list, hero, stats, activity) | consoleBold |
| B2 | plan + branches, pipeline, campaign inbox | consoleBold |
| B3 | contacts + workspace inbox (web chat, client messages) | consoleBold |
| B4 | Site agent + Receptionist | consoleBold + receptionist |
| B5 | Forms, Proposals, Automations + Ada guided build | consoleBold |
| B6 | Lead finder (both modes) | consoleBold |
| B7 | Settings & Business core, senders, credits spend | consoleBold |
| B8 | Integrations + Analytics | consoleBold |
| B9 | First run: auth, 6-step Core, ghost dock, plan + card | firstRunBold |
| B10 | Agency suite + client portal skin | agencyBold |
| B11 | Ads Closed Loop | adsLoop |

Every PR must have: a PROGRESS.md entry, prototype-vs-port screenshot pairs, legacy e2e green. **When a PR opens, bring it to me here for review** (same as PR36–83).

Accept nothing into B0 unless: at 1280×720 AND 924×540 the page itself does not scroll, the Ada bar is fully visible, and all 11 dock tiles fit.

---

## Owner to-dos before specific waves (not blocking B0)

- **Before B9:** Stripe TEST keys available to Claude Code (card capture uses Elements + SetupIntent).
- **Before B4 ships copy:** price the Receptionist add-on ($39/mo is a placeholder).
- **Before B11 ships copy:** confirm Ads Closed Loop at $49/mo covering both platforms.
- **Never:** per-tier limits (1/5/15 workspaces, credit counts) hard-coded — D2 says they're set in the billing UI.
