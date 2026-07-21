-- R1-UI (DEC-088): the account-rules surface goes live on the ONE evaluator.
-- Additive: AutomationRun.eventId — the bus Event row id (or the sweep's
-- synthetic fire-once key `quiet:<enrollmentId>`) for DIRECT account-rule
-- fires. Unique (automationId, eventId) = redelivery idempotency, the
-- CampaignRuleRun pattern; Postgres treats NULLs as distinct, so nested
-- run_automation rows (eventId NULL — the outer rule's (ruleId, eventId) key
-- already dedupes them) and pre-DEC-088 history are untouched.

ALTER TABLE "AutomationRun" ADD COLUMN "eventId" TEXT;
CREATE UNIQUE INDEX "AutomationRun_automationId_eventId_key" ON "AutomationRun"("automationId", "eventId");
