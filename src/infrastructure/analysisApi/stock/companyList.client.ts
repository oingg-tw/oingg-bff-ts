import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { CompanyListEntry, CompanyListResult } from "@/application/proxy/stock/companyList.types.js";

function normalizeEntry(raw: unknown): CompanyListEntry {
  const r = raw as Record<string, unknown>;
  return {
    symbol: String(r.symbol),
    name: String(r.companyName),
    market: String(r.market),
    sectorCode: typeof r.sectorCode === "string" ? r.sectorCode : null,
    sectorName: typeof r.sectorName === "string" ? r.sectorName : null,
    // Upstream guarantees this is always a boolean; `=== true` keeps a malformed response from
    // silently becoming "not 興櫃", which would quietly re-inflate any coverage denominator.
    isEmerging: r.isEmerging === true,
  };
}

function isCompanyListResponse(body: unknown): body is { count: unknown; limit: unknown; offset: unknown; entries: unknown[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { entries?: unknown }).entries);
}

/**
 * Fetches the full-market company directory (symbol/name for every listed TWSE/TPEx company, ~2650 as
 * of 2026-09-11) from analysis-ts's GET /companies — the real data source behind full-site stock search,
 * replacing web-nuxt's own ~20-symbol hardcoded mock list (their GET /api/stocks never existed; the
 * searchbar was never actually wired to real data before this).
 *
 * analysis-ts paginates (limit 1-1000, default 200; offset default 0, no upper bound — an offset past
 * `count` just returns an empty `entries` array, not an error, confirmed live). bff-ts passes both
 * straight through rather than trying to assemble the whole market in one call itself: multiple
 * sequential upstream round trips to satisfy one bff-ts request would add latency and complexity for a
 * pure pass-through endpoint (see feedback_proxy_apis_no_transformation) — the caller pages through using
 * the returned `count` the same way it would against analysis-ts directly.
 *
 * 2026-09-24 這個決定多了一個跟風格無關的理由：**記憶體水位是永久的**。sitca-ts 在 Cloud Run OOM 後
 * 對 Prisma 7 + @prisma/adapter-pg + Neon（bff-ts 用的同一套）實測：保留量**跟單次查詢的大小成正比，
 * 而且第二輪就停住不再成長**——同一份 69,139 列跑三輪，batch 5000 停在 441MB、batch 500 停在 124MB，
 * 降 10 倍批量省 3.5 倍記憶體。是快取不是洩漏，但**機制沒有定論**：原先「pg 的讀取 buffer 按最大查詢
 * 撐開」這個假說已被他們自己否證（同批量只改 pool size，heap 平台完全不動，pool=10 125.2MB
 * vs pool=2 125.0MB，所以是 per-process 不是 per-connection）。這裡只引用觀察、不引用機制。
 * 意思是：只要有**一個**端點做過「一次撈全市場再回傳」，那個 instance 的水位就永久上去，之後每一個
 * 請求都扛著它。bff-ts 目前單次最大回應約 200KB，水位因此很低（實測 120 次請求 183MB→225MB）。
 * 所以不要為了「方便前端」在這裡加一支把所有分頁串起來的端點，那個方便的代價是常駐的。
 */
export async function fetchCompanyList(limit?: number, offset?: number): Promise<CompanyListResult> {
  const searchParams: Record<string, string> = {};
  if (limit !== undefined) {
    searchParams.limit = String(limit);
  }
  if (offset !== undefined) {
    searchParams.offset = String(offset);
  }

  const url = buildAnalysisServiceUrl("/companies", searchParams);
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Company list endpoint");

  const body: unknown = await response.json();
  if (!isCompanyListResponse(body) || typeof body.count !== "number" || typeof body.limit !== "number" || typeof body.offset !== "number") {
    logger.error({ url: url.toString() }, "Company list endpoint response is missing count/limit/offset/entries");
    throw new AppError("Company list endpoint response is missing count/limit/offset/entries", 502);
  }

  return {
    count: body.count,
    limit: body.limit,
    offset: body.offset,
    entries: body.entries.map(normalizeEntry),
  };
}
