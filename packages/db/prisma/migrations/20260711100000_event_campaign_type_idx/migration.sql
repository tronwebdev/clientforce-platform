-- F1 (DEC-068): additive index for the outcomes rollup — every rollup query
-- filters Event by campaign + type set; the existing (workspaceId, type,
-- occurredAt) index doesn't serve campaign-scoped scans. RLS-safe: index only,
-- no row changes, tenant_isolation policy untouched.
CREATE INDEX "Event_workspaceId_campaignId_type_idx" ON "Event"("workspaceId", "campaignId", "type");
