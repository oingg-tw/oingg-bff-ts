-- AlterTable: add nullable first, backfill from web-nuxt's authoritative SCREENER_TEMPLATE_SLUGS mapping,
-- then tighten to NOT NULL + UNIQUE. Values matched exactly against the live sitemap, not chosen independently.
ALTER TABLE "preset_template" ADD COLUMN     "slug" TEXT;

UPDATE "preset_template" SET "slug" = 'value' WHERE "name" = '價值型';
UPDATE "preset_template" SET "slug" = 'low-volatility' WHERE "name" = '低波動';
UPDATE "preset_template" SET "slug" = 'dividend-stability' WHERE "name" = '股利連續性';
UPDATE "preset_template" SET "slug" = 'financial-resilience' WHERE "name" = '財務韌性';
UPDATE "preset_template" SET "slug" = 'earnings-quality' WHERE "name" = '獲利品質';
UPDATE "preset_template" SET "slug" = 'turnaround' WHERE "name" = '轉機股';
UPDATE "preset_template" SET "slug" = 'growth-momentum' WHERE "name" = '成長動能';

ALTER TABLE "preset_template" ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "preset_template_slug_key" ON "preset_template"("slug");
