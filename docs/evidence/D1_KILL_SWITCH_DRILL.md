# D1 · Kill-switch drill — evidence (DEC-175)

**What was being answered.** Suspension (DEC-079) and the per-agency/per-channel
kill switch (DEC-082) are both enforced at the send boundary and both have unit
coverage. Coverage proves the *branch*. It does not answer the question an owner
actually asks with ~100 accounts on one shared IP pool: **after I flip it, how
long does traffic keep going?** This drill measures that, with a real database
and a real send in flight.

**Why the number is what it is.** `assertTenantActive` and `assertChannelLive`
(`packages/channels/src/tenant-status.ts`) run **per send**, reading
`Workspace`/`Agency`/`KillSwitch` directly — no cache, no TTL, no memoized
status. So the propagation delay is one indexed read, and the measurements
below are latency, not eventual consistency. There is nothing to wait for.

## Run

| | |
|---|---|
| Script | `packages/channels/scripts/kill-switch-drill.ts` |
| Workflow | `.github/workflows/kill-switch-drill.yml` (manual dispatch) |
| Date | 2026-09-01 |
| Environment | Postgres 16.13 + pgvector 0.6.0, full migration chain applied, RLS-subject `clientforce_app` role — the same shape CI's `pgvector/pgvector:pg16` service provides |
| Transport | `KeylessSandboxSender` — the drill is about the boundary, and delivering real mail to prove a refusal would be absurd |
| Threshold | 5,000 ms (`DRILL_THRESHOLD_MS`) |

### Scope of this evidence — read this before citing it

This ran against a **real Postgres with the real migration chain, the real
RLS-subject role and the real boundary code**, in the build container. It is
NOT a run against the staging deployment. For a kill switch that is the correct
fidelity — the mechanism is entirely database + boundary, and there is no
provider leg to make real (the whole point is that nothing reaches a provider).
What a staging run would add is the deployed container's own config, so the
dispatchable workflow exists for the owner to produce that run on demand; when
it lands, its run URL belongs in the PROGRESS.md Live verification log beside
this row.

## Output (verbatim — the third of three consecutive runs)

```

=== D1 KILL-SWITCH DRILL (DEC-175) ===
threshold: 5000ms · started 2026-09-01T08:20:24.941Z

── KILL SWITCH · agency + email channel ──
  ✓ baseline send — traffic is flowing
  ✓ stopped in 9ms — CHANNEL_KILLED: Send blocked (CHANNEL_KILLED): email killed: drill
  ✓ restored in 34ms — traffic resumed after clearing

── SUSPENSION · workspace ──
  ✓ baseline send — traffic is flowing
  ✓ stopped in 5ms — TENANT_SUSPENDED: Send blocked (TENANT_SUSPENDED): workspace suspended
  ✓ restored in 24ms — traffic resumed after clearing

── SUSPENSION · agency (cascades to its workspaces) ──
  ✓ baseline send — traffic is flowing
  ✓ stopped in 5ms — TENANT_SUSPENDED: Send blocked (TENANT_SUSPENDED): agency suspended
  ✓ restored in 32ms — traffic resumed after clearing

=== RESULT ===
stop                                              refusal            flip→stop   restore
KILL SWITCH · agency + email channel              CHANNEL_KILLED     9ms         34ms
SUSPENSION · workspace                            TENANT_SUSPENDED   5ms         24ms
SUSPENSION · agency (cascades to its workspaces)  TENANT_SUSPENDED   5ms         32ms

slowest stop: 9ms (threshold 5000ms)
DRILL PASSED — every stop refused typed, within threshold, and reversed.
```

## Result

| Stop | Typed refusal | Flip → traffic stopped | Cleared → traffic resumed |
|---|---|---|---|
| Kill switch · agency + email channel | `CHANNEL_KILLED` | **9 ms** | 34 ms |
| Suspension · workspace | `TENANT_SUSPENDED` | **5 ms** | 24 ms |
| Suspension · agency (cascades to its workspaces) | `TENANT_SUSPENDED` | **5 ms** | 32 ms |

**Slowest stop: 9 ms.** Three orders of magnitude inside "within seconds".

**Run-to-run variance, since one run is not a measurement.** Three consecutive
runs gave a slowest stop of **7 ms · 7 ms · 9 ms**. The spread is scheduling and
connection-pool noise on a single indexed read; nothing in the range is close
to the threshold, and the drill fails loudly if any single stop exceeds it.

Each row is a full cycle, not a single assertion: a send that **succeeded**
first (so the measurement is of traffic actually being stopped, not of a
workspace that was never sending), the flip, the typed refusal, then the clear
and a send that **succeeded again**. Reversibility is part of the drill because
a stop nobody can undo is an outage, not a safety rail.

## What this does NOT prove

- **Sends already in flight.** The drill measures the boundary refusing the
  *next* send. A send that has already passed the boundary and is inside the
  SendGrid API call completes — there is no cancel for a request in flight, and
  claiming otherwise would be false. The exposure is one in-flight send per
  worker, not a queue drain.
- **The staging container's config**, per the scope note above.
