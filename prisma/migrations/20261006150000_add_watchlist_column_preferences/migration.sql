-- 自選股表格的自訂欄位（使用者 2026-10-06 決定）。新表，不動任何既有資料。
-- CreateTable
CREATE TABLE "watchlist_column_preferences" (
    "firebase_uid" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watchlist_column_preferences_pkey" PRIMARY KEY ("firebase_uid")
);
