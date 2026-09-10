-- AlterTable
ALTER TABLE "filter_metric" ADD COLUMN     "sources" TEXT[] DEFAULT ARRAY[]::TEXT[];
