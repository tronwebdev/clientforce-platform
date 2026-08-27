-- B3c-1 (DEC-118): call consent (granted | denied | unknown; unknown = Ada
-- may not call) and the contact-local quiet-hours timezone source.
ALTER TABLE "Contact" ADD COLUMN "callConsent" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "Contact" ADD COLUMN "timezone" TEXT;
