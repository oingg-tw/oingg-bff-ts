-- 成本不明的取得（使用者 2026-10-05 決定）。NOT NULL DEFAULT false：既有的每一列都是成本已知的交易，
-- 所以預設值是事實而不是猜測。舊程式碼不讀這欄，對還在跑舊版的部署端是向後相容的。
ALTER TABLE "stock_transaction" ADD COLUMN "cost_unknown" BOOLEAN NOT NULL DEFAULT false;
