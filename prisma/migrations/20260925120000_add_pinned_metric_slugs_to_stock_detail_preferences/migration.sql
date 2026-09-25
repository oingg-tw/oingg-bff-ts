-- AlterTable
--
-- 刻意 nullable 而不是 NOT NULL DEFAULT '[]'：既有的列（使用者已經存過 mode + visible_card_ids）
-- 沒有釘選過任何指標，而 '[]' 的語意是「使用者主動把釘選全部取消」。給預設值會讓每個既有使用者
-- 被讀成後者，前端就不會套用預設的釘選清單。NULL 才是「這個帳號還沒設定過這一項」。
ALTER TABLE "stock_detail_preferences" ADD COLUMN     "pinned_metric_slugs" JSONB;
