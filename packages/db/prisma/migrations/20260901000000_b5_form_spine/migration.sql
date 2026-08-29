-- B5 (DEC-130): the form spine's two additive columns — a publish state and
-- the public credential (minted at first publish; the only identifier that
-- ever leaves the platform, the widget's wgt_ stance).
ALTER TABLE "Form" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE "Form" ADD COLUMN "publicId" TEXT;
CREATE UNIQUE INDEX "Form_publicId_key" ON "Form"("publicId");
