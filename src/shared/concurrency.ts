/**
 * 依序處理 items，最多 `limit` 個同時進行，結果照原本的順序回傳。
 *
 * 用在對 analysis-ts 的批次呼叫：一個組合可能有 50 檔以上、一本帳可能跨 30 個月，全部同時送出對
 * 上游不友善。任何一個失敗就整個失敗（跟 Promise.all 一樣）——上游壞掉時寧可回 502，也不要把
 * 「部分資料」當成完整的算下去。
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}
