-- AlterTable
ALTER TABLE "screener_preset" ADD COLUMN     "sector_codes" JSONB NOT NULL DEFAULT '[]';
