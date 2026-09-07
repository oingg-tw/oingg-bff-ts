-- CreateEnum
CREATE TYPE "StockDetailPageMode" AS ENUM ('CARD', 'ACCOUNTING');

-- CreateTable
CREATE TABLE "stock_detail_preferences" (
    "firebase_uid" TEXT NOT NULL,
    "mode" "StockDetailPageMode" NOT NULL,
    "visible_card_ids" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_detail_preferences_pkey" PRIMARY KEY ("firebase_uid")
);
