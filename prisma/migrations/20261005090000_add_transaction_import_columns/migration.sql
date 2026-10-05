-- 批次匯入（POST /transactions/import）需要的三個欄位與兩個索引。
--
-- 三個欄位都可為 null，而且舊程式碼不讀它們，所以這個 migration 對部署端是向後相容的——本機與部署端
-- 共用同一個 Neon 資料庫，先套用不會弄壞還在跑舊版的那一端。
--
-- 唯一索引裡的 NULL 在 Postgres 不互相碰撞，所以手動輸入的列（source 與 external_ref 都是 null）
-- 完全不受這把鍵限制。這是刻意利用的性質。
ALTER TABLE "stock_transaction" ADD COLUMN "source" TEXT;
ALTER TABLE "stock_transaction" ADD COLUMN "external_ref" TEXT;
ALTER TABLE "stock_transaction" ADD COLUMN "import_id" UUID;

CREATE UNIQUE INDEX "stock_transaction_firebase_uid_source_external_ref_key"
  ON "stock_transaction" ("firebase_uid", "source", "external_ref");

CREATE INDEX "stock_transaction_firebase_uid_import_id_idx"
  ON "stock_transaction" ("firebase_uid", "import_id");
