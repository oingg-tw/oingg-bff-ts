/**
 * reorder 用：把「新順序」轉成 [position, id]，但**依 id 排序**後再逐列 update。
 *
 * 2026-10-11 壓測（races）實測：同一個使用者 10 個並發 reorder，9 個 500，原因是 Postgres deadlock（40P01）——
 * 每個交易照「自己要的新順序」逐列更新，鎖列的先後各不相同，於是互相等待。所有交易都照同一個順序（id）鎖列，
 * 後到的只會排隊等前一個 commit，不會死結；最後的順序是最後 commit 的那個請求的完整順序。
 */
export function positionsInLockOrder(orderedIds: string[]): [position: number, id: string][] {
  return [...orderedIds.entries()].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
}
