-- AlterTable
ALTER TABLE "column_preset" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "screener_preset" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- Backfill: preserve each user's CURRENT visible order (createdAt desc, the previous default sort) as
-- their starting position, instead of leaving every existing row at the same default 0 — a real reshuffle
-- for existing users the first time this ships, not just a schema no-op.
UPDATE "column_preset" cp
SET "position" = ranked.rn - 1
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY firebase_uid ORDER BY created_at DESC) AS rn
  FROM "column_preset"
) ranked
WHERE cp.id = ranked.id;

UPDATE "screener_preset" sp
SET "position" = ranked.rn - 1
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY firebase_uid ORDER BY created_at DESC) AS rn
  FROM "screener_preset"
) ranked
WHERE sp.id = ranked.id;
