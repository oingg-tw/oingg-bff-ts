-- CreateEnum
CREATE TYPE "PreferredStocksColumnPreset" AS ENUM ('ALL', 'CONTRACT_TERMS', 'VALUATION', 'CALL_RISK');

-- CreateTable
CREATE TABLE "preferred_stocks_preferences" (
    "firebase_uid" TEXT NOT NULL,
    "column_preset_id" "PreferredStocksColumnPreset" NOT NULL,
    "column_order" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preferred_stocks_preferences_pkey" PRIMARY KEY ("firebase_uid")
);
