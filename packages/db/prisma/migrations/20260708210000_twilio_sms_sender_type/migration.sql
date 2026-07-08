-- P2.1 (DEC-061): SMS opens Phase 2 — the one schema change is the sender type.
ALTER TYPE "SenderType" ADD VALUE 'TWILIO_SMS';
