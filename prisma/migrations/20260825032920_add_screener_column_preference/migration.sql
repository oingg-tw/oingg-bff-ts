-- CreateTable
CREATE TABLE "screener_column_preference" (
    "id" SERIAL NOT NULL,
    "firebase_uid" TEXT NOT NULL,
    "metric_key" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screener_column_preference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "screener_column_preference_firebase_uid_idx" ON "screener_column_preference"("firebase_uid");

-- CreateIndex
CREATE UNIQUE INDEX "screener_column_preference_firebase_uid_metric_key_field_ke_key" ON "screener_column_preference"("firebase_uid", "metric_key", "field_key");

-- AddForeignKey
ALTER TABLE "screener_column_preference" ADD CONSTRAINT "screener_column_preference_metric_key_field_key_fkey" FOREIGN KEY ("metric_key", "field_key") REFERENCES "filter_metric_field"("metric_key", "key") ON DELETE CASCADE ON UPDATE CASCADE;
