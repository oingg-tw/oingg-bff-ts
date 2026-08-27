/*
  Warnings:

  - You are about to drop the `screener_column_preference` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "screener_column_preference" DROP CONSTRAINT "screener_column_preference_metric_key_field_key_fkey";

-- AlterTable
ALTER TABLE "screener_preset" ADD COLUMN     "last_column_preset_id" INTEGER;

-- DropTable
DROP TABLE "screener_column_preference";

-- CreateTable
CREATE TABLE "column_preset" (
    "id" SERIAL NOT NULL,
    "firebase_uid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "column_preset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "column_preset_field" (
    "id" SERIAL NOT NULL,
    "preset_id" INTEGER NOT NULL,
    "field" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "column_preset_field_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "column_preset_firebase_uid_idx" ON "column_preset"("firebase_uid");

-- CreateIndex
CREATE UNIQUE INDEX "column_preset_firebase_uid_name_key" ON "column_preset"("firebase_uid", "name");

-- CreateIndex
CREATE INDEX "column_preset_field_preset_id_idx" ON "column_preset_field"("preset_id");

-- AddForeignKey
ALTER TABLE "column_preset_field" ADD CONSTRAINT "column_preset_field_preset_id_fkey" FOREIGN KEY ("preset_id") REFERENCES "column_preset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screener_preset" ADD CONSTRAINT "screener_preset_last_column_preset_id_fkey" FOREIGN KEY ("last_column_preset_id") REFERENCES "column_preset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
