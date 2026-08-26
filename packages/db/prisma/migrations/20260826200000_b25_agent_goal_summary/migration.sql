-- B2.5 (DEC-109, closes Q-069): the guided-create goal sentence. Nullable —
-- legacy rows keep the goalSentence() fallback chain (free text, then brief).
ALTER TABLE "Agent" ADD COLUMN "goalSummary" TEXT;
