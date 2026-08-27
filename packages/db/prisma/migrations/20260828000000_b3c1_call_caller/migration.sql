-- B3c-1 (DEC-113/118): caller attribution on the one Call spine.
ALTER TABLE "Call" ADD COLUMN "caller" TEXT NOT NULL DEFAULT 'ada';
ALTER TABLE "Call" ADD COLUMN "placedById" TEXT;
