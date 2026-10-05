-- 持股頁的自訂公式欄位（使用者 2026-10-05 要求）。新表，不動任何既有資料。
-- CreateTable
CREATE TABLE "holding_column_preferences" (
    "firebase_uid" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holding_column_preferences_pkey" PRIMARY KEY ("firebase_uid")
);

