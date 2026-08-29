-- B4 (DEC-120(2)): the widget's per-workspace call-consent ask — DEFAULT OFF.
ALTER TABLE "Widget" ADD COLUMN "consentAsk" BOOLEAN NOT NULL DEFAULT false;
