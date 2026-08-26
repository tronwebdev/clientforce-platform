-- B2.6 (DEC-110, closes Q-066): the Ada-suggestion marker on draft agents.
-- Nullable — owner-created rows are untouched; dismissal stamps dismissedAt
-- inside the Json so a signal is never re-suggested.
ALTER TABLE "Agent" ADD COLUMN "suggestion" JSONB;
