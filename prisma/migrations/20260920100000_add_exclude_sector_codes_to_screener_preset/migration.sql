-- AlterTable
ALTER TABLE "screener_preset" ADD COLUMN     "exclude_sector_codes" JSONB NOT NULL DEFAULT '[]';
