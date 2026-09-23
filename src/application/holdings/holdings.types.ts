export interface Holding {
  id: string;
  symbol: string;
  quantity: number;
  averageCost: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * PATCH /holdings/:id 的部分更新。欄位省略代表「不動」，note 則可以明確設成 null 清空——所以
 * `note?: string | null` 的三種狀態（缺席 / null / 字串）都有意義，不要簡化成 `note?: string`。
 *
 * 型別原本住在 holdings.repository.ts，等於 application 與 http 都得 import infrastructure 才拿得到
 * 這個 DTO。它描述的是使用者意圖，不是 Prisma 的 data 形狀，本來就該住這裡。
 */
export interface HoldingUpdate {
  quantity?: number;
  averageCost?: number;
  note?: string | null;
}
