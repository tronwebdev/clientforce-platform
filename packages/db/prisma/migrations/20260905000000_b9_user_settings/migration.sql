-- B9 (DEC-136, tour addendum): per-user preferences (tour-seen persists
-- with the account, never a browser). Additive, default {}.
ALTER TABLE "User" ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';
