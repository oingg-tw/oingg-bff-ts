import { vi } from "vitest";
import type { TransactionsPort } from "@/application/ports/transactions.js";

/**
 * TransactionsPort 的具型別 fake，不是 `vi.mock` 的 repository 模組。測試因此陳述的是服務依賴的
 * **契約**，換掉底下的儲存實作也不會紅；而且它漂不掉——物件必須滿足 TransactionsPort，所以 port
 * 多一個方法會在編譯期壞掉而不是在執行期。
 *
 * 住在 fakes/ 而不是各測試檔自己一份：2026-10-05 加了四個匯入用的方法時，兩個測試檔同時編譯失敗，
 * 那正是「同一份 fake 應該只有一處」的訊號。持股、交易、匯入三個切片都讀這個 port。
 */
export function fakeTransactions(overrides: Partial<TransactionsPort> = {}): TransactionsPort {
  return {
    list: vi.fn().mockResolvedValue([]),
    find: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(false),
    removeBySymbol: vi.fn().mockResolvedValue(0),
    removeAll: vi.fn().mockResolvedValue(0),
    createManyImported: vi.fn().mockResolvedValue(0),
    existingExternalRefs: vi.fn().mockResolvedValue([]),
    removeByImportId: vi.fn().mockResolvedValue(0),
    listByImportId: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}
