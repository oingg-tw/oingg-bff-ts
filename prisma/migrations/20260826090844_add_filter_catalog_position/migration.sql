/*
  Warnings:

  - Added the required column `position` to the `filter_category` table without a default value. This is not possible if the table is not empty.
  - Added the required column `position` to the `filter_metric` table without a default value. This is not possible if the table is not empty.
  - Added the required column `position` to the `filter_metric_field` table without a default value. This is not possible if the table is not empty.

*/
-- This whole table is wiped and rewritten by every filter catalog sync (see
-- filterCatalog.repository.ts), so a temporary 0 for existing rows is fine — it's corrected on the
-- very next sync. DEFAULT dropped after backfilling so future inserts must supply a real position.
-- AlterTable
ALTER TABLE "filter_category" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "filter_category" ALTER COLUMN "position" DROP DEFAULT;

-- AlterTable
ALTER TABLE "filter_metric" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "filter_metric" ALTER COLUMN "position" DROP DEFAULT;

-- AlterTable
ALTER TABLE "filter_metric_field" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "filter_metric_field" ALTER COLUMN "position" DROP DEFAULT;
