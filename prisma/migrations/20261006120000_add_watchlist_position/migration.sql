-- 自選股自訂排序（使用者 2026-10-06 決定）。舊程式碼不讀這欄，對還在跑舊版的部署端是向後相容的。
ALTER TABLE "watchlist_item" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- 既有清單照使用者現在看到的順序編號（舊版依 created_at 新到舊排），改版後的第一眼不會換順序。
-- 之後新加入的才排最後。
UPDATE "watchlist_item" AS w
SET "position" = ranked.rn - 1
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "firebase_uid" ORDER BY "created_at" DESC) AS rn
  FROM "watchlist_item"
) AS ranked
WHERE w."id" = ranked."id";
