-- B2 (DEC-106): CreditPrice becomes tenant-path readable (GET /credit-prices).
-- Writes stay backoffice-only (DEC-080) — enforce that at the DB layer too,
-- the same ride-along hardening KillSwitch/FeatureFlag got when the app began
-- reading them (B1 W4): the RLS-subject app role keeps SELECT, loses writes.
REVOKE INSERT, UPDATE, DELETE ON "CreditPrice" FROM clientforce_app;
