-- 2026-10-05：持股明細改成由 stock_transaction 算出的唯讀投影（commit 4467c44），這張表從那時起就沒有
-- 任何程式碼讀寫。刻意等到新程式碼部署上 DEV（revision 00009-fdq，280e7ef）才刪：本機與部署端共用同一個
-- Neon 資料庫，先刪會讓還在跑舊程式碼的部署端 GET /holdings 一路 500。
--
-- 刪除前實查：0 列、沒有任何外鍵指向它。`prisma migrate diff`（資料庫 → schema）算出的差異只有這一行。
-- 使用者 2026-10-05 同意刪除。
DROP TABLE "holding";
