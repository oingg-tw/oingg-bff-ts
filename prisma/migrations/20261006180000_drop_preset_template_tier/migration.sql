-- 拿掉選股範本的 tier（使用者 2026-10-06 決定）。選股範本與結果依投信投顧法不能依方案上鎖，
-- 所以一個「PAID」選項只會讓人以為可以鎖。拿掉時 7 列全是 FREE，沒有任何使用者資料參照這一欄。
ALTER TABLE "preset_template" DROP COLUMN "tier";

DROP TYPE "PresetTemplateTier";
