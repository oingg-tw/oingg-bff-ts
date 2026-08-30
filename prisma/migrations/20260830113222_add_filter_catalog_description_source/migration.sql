-- AlterTable
ALTER TABLE "filter_metric" ADD COLUMN     "description" TEXT,
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "filter_metric_field" ADD COLUMN     "description" TEXT,
ADD COLUMN     "source" TEXT;
