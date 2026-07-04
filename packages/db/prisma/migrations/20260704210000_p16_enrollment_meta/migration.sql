-- P1.6: Enrollment.meta — the durable run's user-visible audit trail
-- (send-boundary refusals, intended actions, branch routing). The Logs tab
-- renders refusals/adjustments as distinct amber rows (P1.8_UI_WIRING_NOTES
-- §Logs, owner edit 2026-07-04) — so blocks are DATA, not server logs.
ALTER TABLE "Enrollment" ADD COLUMN "meta" JSONB NOT NULL DEFAULT '{}';
