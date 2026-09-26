-- 指標的英文縮寫（ROIC、PER、EBIT Margin…）。
--
-- 刻意可為 NULL 且沒有預設值：上游 64/156 支有縮寫，其餘沒有，而「沒有縮寫」跟「縮寫是空字串」
-- 在下游意思不同（前者不該顯示副標，後者會顯示一個空的副標）。給預設值等於替上游編造資料。
--
-- 不需要回填：型錄每次啟動都會從 analysis-ts 重新同步整份（也可用 POST /metrics/sync 手動觸發），
-- 所以這一欄在下一次同步就會有值，不必寫 UPDATE。
ALTER TABLE "metric_definition" ADD COLUMN "name_en" TEXT;
