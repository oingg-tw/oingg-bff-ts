/*
  Warnings:

  - The primary key for the `column_preset` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `holding` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `screener_preset` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `last_column_preset_id` column on the `screener_preset` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `stock_transaction` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `watchlist_item` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Changed the type of `id` on the `column_preset` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `preset_id` on the `column_preset_field` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `holding` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `screener_preset` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `preset_id` on the `screener_preset_filter` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `stock_transaction` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `watchlist_item` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropForeignKey
ALTER TABLE "column_preset_field" DROP CONSTRAINT "column_preset_field_preset_id_fkey";

-- DropForeignKey
ALTER TABLE "screener_preset" DROP CONSTRAINT "screener_preset_last_column_preset_id_fkey";

-- DropForeignKey
ALTER TABLE "screener_preset_filter" DROP CONSTRAINT "screener_preset_filter_preset_id_fkey";

-- AlterTable
ALTER TABLE "column_preset" DROP CONSTRAINT "column_preset_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "column_preset_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "column_preset_field" DROP COLUMN "preset_id",
ADD COLUMN     "preset_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "holding" DROP CONSTRAINT "holding_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "holding_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "screener_preset" DROP CONSTRAINT "screener_preset_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "last_column_preset_id",
ADD COLUMN     "last_column_preset_id" UUID,
ADD CONSTRAINT "screener_preset_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "screener_preset_filter" DROP COLUMN "preset_id",
ADD COLUMN     "preset_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "stock_transaction" DROP CONSTRAINT "stock_transaction_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "stock_transaction_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "watchlist_item" DROP CONSTRAINT "watchlist_item_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "watchlist_item_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE INDEX "column_preset_field_preset_id_idx" ON "column_preset_field"("preset_id");

-- CreateIndex
CREATE INDEX "screener_preset_filter_preset_id_idx" ON "screener_preset_filter"("preset_id");

-- AddForeignKey
ALTER TABLE "column_preset_field" ADD CONSTRAINT "column_preset_field_preset_id_fkey" FOREIGN KEY ("preset_id") REFERENCES "column_preset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screener_preset" ADD CONSTRAINT "screener_preset_last_column_preset_id_fkey" FOREIGN KEY ("last_column_preset_id") REFERENCES "column_preset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screener_preset_filter" ADD CONSTRAINT "screener_preset_filter_preset_id_fkey" FOREIGN KEY ("preset_id") REFERENCES "screener_preset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
