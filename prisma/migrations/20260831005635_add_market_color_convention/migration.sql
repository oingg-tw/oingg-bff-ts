-- CreateEnum
CREATE TYPE "MarketColorConvention" AS ENUM ('ASIA', 'WESTERN');

-- AlterTable
ALTER TABLE "user_theme_preference" ADD COLUMN     "market_color_convention" "MarketColorConvention";
