-- Row-Level Security: tenant isolation on every workspace-scoped table.
--
-- Strategy (see DATA_MODEL.md §1 and the PR description):
--   * Each tenant table gets a `tenant_isolation` policy keyed on the
--     `app.workspace_id` GUC, set per-request/transaction by the tenant-scoped
--     Prisma client. With the GUC unset, current_setting(..., true) returns NULL
--     and the predicate matches no rows — fail-closed.
--   * RLS is ENABLEd and FORCEd so the table owner is also subject to it
--     (defence in depth). Superusers always bypass RLS, so migrations and the
--     seed (run as the privileged owner) can still operate across workspaces.
--   * Runtime + the isolation test connect as the non-superuser `clientforce_app`
--     role, which has no BYPASSRLS — so it is genuinely constrained by the policy.

-- 1. Apply ENABLE + FORCE RLS and the tenant_isolation policy to every
--    workspace-scoped table.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'Membership',
    'KnowledgeSource',
    'KnowledgeChunk',
    'BusinessContext',
    'Agent',
    'Campaign',
    'CampaignGraph',
    'Contact',
    'Enrollment',
    'PipelineStage',
    'ContactList',
    'ListMembership',
    'Event',
    'Automation',
    'AutomationRun',
    'Integration',
    'Sender',
    'WebhookEndpoint',
    'WebhookDelivery',
    'CreditLedger',
    'Form',
    'FormSubmission',
    'Proposal',
    'ProposalSend',
    'Widget',
    'MetricDaily'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING ("workspaceId" = current_setting(''app.workspace_id'', true)) '
      'WITH CHECK ("workspaceId" = current_setting(''app.workspace_id'', true));',
      t
    );
  END LOOP;
END $$;

-- 2. The runtime application role: non-superuser, no BYPASSRLS, so it is subject
--    to the policies above. Created without a password here; the connecting auth
--    (trust in CI/dev, a Key Vault secret via `ALTER ROLE` in production — T7) is
--    provisioned out-of-band so no credential lives in the repo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clientforce_app') THEN
    CREATE ROLE clientforce_app LOGIN;
  END IF;
END $$;

-- 3. Grant the app role DML on current and future tables/sequences. ALTER
--    DEFAULT PRIVILEGES (as the migration owner) means tables added by later
--    migrations inherit these grants automatically.
GRANT USAGE ON SCHEMA public TO clientforce_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clientforce_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO clientforce_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clientforce_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO clientforce_app;
