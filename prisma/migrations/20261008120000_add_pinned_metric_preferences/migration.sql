-- 自選指標釘選（使用者 2026-10-08 決定）：web-nuxt 刪掉了個股頁的卡片偏好，但釘選（側邊欄與速覽頁）還在用，
-- 而它原本寄存在 stock_detail_preferences.pinned_metric_slugs。這裡開一張只放釘選的新表，並把既有的釘選搬過來。
-- 只新增、不刪任何東西：stock_detail_preferences 等不含舊端點的程式部署到 DEV 之後才 DROP（本機與 DEV 共用 Neon）。

-- CreateTable
CREATE TABLE "pinned_metric_preferences" (
    "firebase_uid" TEXT NOT NULL,
    "slugs" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pinned_metric_preferences_pkey" PRIMARY KEY ("firebase_uid")
);

-- 搬既有的釘選。只搬 pinned_metric_slugs 不是 NULL 的列：NULL 的意思是「這個帳號從沒存過釘選」（前端套預設），
-- 新表用「沒有這一列」表達同一件事，所以不寫一列 NULL 進來。[]（使用者把釘選全取消了）照搬，跟 NULL 不同。
INSERT INTO "pinned_metric_preferences" ("firebase_uid", "slugs", "updated_at")
SELECT "firebase_uid", "pinned_metric_slugs", "updated_at"
FROM "stock_detail_preferences"
WHERE "pinned_metric_slugs" IS NOT NULL
ON CONFLICT ("firebase_uid") DO NOTHING;
