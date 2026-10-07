import type { AppDeps } from "@/application/deps.js";

/**
 * symbol → 證交所類股（/holdings/risk 的類股配置用，2026-10-07）。上游只有整份公司清單（約 2,300 家，
 * 一頁最多 1,000），所以整份抓下來放程式內快取。類股分類幾乎不變，24 小時 TTL 綽綽有餘。
 *
 * ponytail: 程序內快取，多個 instance 各一份、重啟清空，跟 marketWindow.ts 的股價快取同一個取捨。
 */
export type SectorDirectoryDeps = Pick<AppDeps, "stockGateway">;

const TTL_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;
let cache: { fetchedAt: number; sectors: Map<string, { sectorCode: string | null; sectorName: string | null }> } | undefined;

/** 只給測試用。 */
export function resetSectorDirectoryCache(): void {
  cache = undefined;
}

export async function sectorDirectory(deps: SectorDirectoryDeps): Promise<Map<string, { sectorCode: string | null; sectorName: string | null }>> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return cache.sectors;
  }
  const sectors = new Map<string, { sectorCode: string | null; sectorName: string | null }>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await deps.stockGateway.getCompanyList(PAGE_SIZE, offset);
    for (const entry of page.entries) {
      sectors.set(entry.symbol, { sectorCode: entry.sectorCode, sectorName: entry.sectorName });
    }
    if (page.entries.length < PAGE_SIZE || offset + PAGE_SIZE >= page.count) {
      break;
    }
  }
  cache = { fetchedAt: Date.now(), sectors };
  return sectors;
}
