-- B6 (PR #39): wizard draft-resume — the wizard's local working set persists
-- on the DRAFT agent so "Continue setup" can restore the exact step + entries.
ALTER TABLE "Agent" ADD COLUMN "draftState" JSONB;
