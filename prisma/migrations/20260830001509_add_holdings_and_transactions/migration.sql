-- CreateEnum
CREATE TYPE "TransactionAction" AS ENUM ('BUY', 'SELL');

-- CreateTable
CREATE TABLE "holding" (
    "id" SERIAL NOT NULL,
    "firebase_uid" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "average_cost" DECIMAL(18,4) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transaction" (
    "id" SERIAL NOT NULL,
    "firebase_uid" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "action" "TransactionAction" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    "fee" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "trade_date" DATE NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "holding_firebase_uid_idx" ON "holding"("firebase_uid");

-- CreateIndex
CREATE UNIQUE INDEX "holding_firebase_uid_symbol_key" ON "holding"("firebase_uid", "symbol");

-- CreateIndex
CREATE INDEX "stock_transaction_firebase_uid_trade_date_idx" ON "stock_transaction"("firebase_uid", "trade_date");
