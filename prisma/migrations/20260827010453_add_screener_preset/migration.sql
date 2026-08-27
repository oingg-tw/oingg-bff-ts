-- CreateTable
CREATE TABLE "screener_preset" (
    "id" SERIAL NOT NULL,
    "firebase_uid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screener_preset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screener_preset_filter" (
    "id" SERIAL NOT NULL,
    "preset_id" INTEGER NOT NULL,
    "metric_key" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "min" DOUBLE PRECISION,
    "max" DOUBLE PRECISION,
    "exclude" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,

    CONSTRAINT "screener_preset_filter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "screener_preset_firebase_uid_idx" ON "screener_preset"("firebase_uid");

-- CreateIndex
CREATE UNIQUE INDEX "screener_preset_firebase_uid_name_key" ON "screener_preset"("firebase_uid", "name");

-- CreateIndex
CREATE INDEX "screener_preset_filter_preset_id_idx" ON "screener_preset_filter"("preset_id");

-- AddForeignKey
ALTER TABLE "screener_preset_filter" ADD CONSTRAINT "screener_preset_filter_preset_id_fkey" FOREIGN KEY ("preset_id") REFERENCES "screener_preset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screener_preset_filter" ADD CONSTRAINT "screener_preset_filter_metric_key_field_key_fkey" FOREIGN KEY ("metric_key", "field_key") REFERENCES "filter_metric_field"("metric_key", "key") ON DELETE CASCADE ON UPDATE CASCADE;
