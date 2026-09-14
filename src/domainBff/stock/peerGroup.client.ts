import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type {
  PeerGroupClassificationLevel,
  PeerGroupClassificationSource,
  PeerGroupCompany,
  PeerGroupResult,
} from "@/domainBff/stock/peerGroup.types.js";

function isClassificationLevel(value: unknown): value is PeerGroupClassificationLevel {
  return value === "category" || value === "coarseGroup";
}

function isClassificationSource(value: unknown): value is PeerGroupClassificationSource {
  return value === "keyword" || value === "gemini";
}

function normalizePeer(raw: unknown): PeerGroupCompany {
  const r = raw as Record<string, unknown>;
  return {
    symbol: String(r.symbol),
    companyName: typeof r.companyName === "string" ? r.companyName : null,
  };
}

export interface PeerGroupParams {
  minPeers?: number;
}

/**
 * Fetches a symbol's supply-chain-derived peer group from analysis-ts's GET /companies/peer-group —
 * see peerGroup.types.ts's PeerGroupResult for the full shape/behavior notes. `minPeers` is optional;
 * analysis-ts applies its own default (3) when omitted. `minConfidence`/`minSampleSize` were removed
 * 2026-09-15 alongside the confidence/sampleSize -> source field change — analysis-ts's own data showed
 * the keyword-only population was under 1%, so the filter had no real use, and findPeerGroup() on their
 * side dropped the params entirely.
 */
export async function fetchPeerGroup(symbol: string, params: PeerGroupParams = {}): Promise<PeerGroupResult> {
  const searchParams: Record<string, string> = { symbol };
  if (params.minPeers !== undefined) {
    searchParams.minPeers = String(params.minPeers);
  }

  const url = buildAnalysisServiceUrl("/companies/peer-group", searchParams);
  const response = await fetchAnalysisService(url);

  if (response.status === 400) {
    const body: unknown = await response.json().catch(() => null);
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message !== "string") {
      logger.error({ url: url.toString() }, "Invalid peer group request, no message in response body");
    }
    throw new AppError(typeof message === "string" ? message : "Invalid peer group request", 400);
  }
  assertAnalysisServiceOk(response, url, "Peer group endpoint");

  const body: unknown = await response.json();
  const b = body as Record<string, unknown>;
  if (typeof b.symbol !== "string" || typeof b.found !== "boolean" || !Array.isArray(b.peers) || !Array.isArray(b.warnings)) {
    logger.error({ url: url.toString() }, "Peer group endpoint response is missing expected fields");
    throw new AppError("Peer group endpoint response is missing expected fields", 502);
  }

  return {
    symbol: b.symbol,
    companyName: typeof b.companyName === "string" ? b.companyName : null,
    found: b.found,
    classificationLevel: isClassificationLevel(b.classificationLevel) ? b.classificationLevel : null,
    industryCode: typeof b.industryCode === "string" ? b.industryCode : null,
    industryName: typeof b.industryName === "string" ? b.industryName : null,
    source: isClassificationSource(b.source) ? b.source : null,
    updatedAt: typeof b.updatedAt === "string" ? b.updatedAt : null,
    peers: b.peers.map(normalizePeer),
    warnings: b.warnings.map(String),
  };
}
