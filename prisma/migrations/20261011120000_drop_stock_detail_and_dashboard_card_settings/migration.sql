-- 個股頁卡片偏好與首頁卡片設定：使用者 2026-10-08 決定移除兩個功能（884d0d8 拿掉端點），2026-10-11 核准 DROP。
-- 不含舊端點的程式 2026-10-11 部署到 DEV（a33b291，revision 00015）之後才下——本機與 DEV 共用同一個 Neon。

-- 釘選已在 20261008120000 搬到 pinned_metric_preferences。DROP 前再同步一次：搬完之後若舊程式又寫了舊表，
-- 保留 updated_at 較新的那筆，不讓任何釘選遺失（2026-10-11 套用前實測：2 列都已是新表較新或相同，這段是 no-op）。
INSERT INTO "pinned_metric_preferences" ("firebase_uid", "slugs", "updated_at")
SELECT "firebase_uid", "pinned_metric_slugs", "updated_at"
FROM "stock_detail_preferences"
WHERE "pinned_metric_slugs" IS NOT NULL
ON CONFLICT ("firebase_uid") DO UPDATE
SET "slugs" = EXCLUDED."slugs", "updated_at" = EXCLUDED."updated_at"
WHERE EXCLUDED."updated_at" > "pinned_metric_preferences"."updated_at";

-- DropTable
DROP TABLE "stock_detail_preferences";

-- DropTable
DROP TABLE "dashboard_card_settings";

-- DropEnum
DROP TYPE "StockDetailPageMode";
