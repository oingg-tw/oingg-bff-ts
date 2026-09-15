import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type {
  PeerGroupClassificationSource,
  PeerGroupCompany,
  PeerGroupLevel,
  PeerGroupNotFoundReason,
  PeerGroupResult,
} from "@/domainBff/stock/peerGroup.types.js";

function isPeerGroupLevel(value: unknown): value is PeerGroupLevel {
  return value === "coarse_group" || value === "category" || value === "segment";
}

function isNotFoundReason(value: unknown): value is PeerGroupNotFoundReason {
  return value === "not_classified" || value === "insufficient_peers";
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
 * analysis-ts applies its own default when omitted (3 originally, raised to 5 2026-09-15 alongside the
 * peer-selection algorithm rewrite). `minConfidence`/`minSampleSize` were removed 2026-09-15 alongside the
 * confidence/sampleSize -> source field change — analysis-ts's own data showed the keyword-only population
 * was under 1%, so the filter had no real use, and findPeerGroup() on their side dropped the params
 * entirely.
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
    notFoundReason: isNotFoundReason(b.notFoundReason) ? b.notFoundReason : null,
    peerGroupLevel: isPeerGroupLevel(b.peerGroupLevel) ? b.peerGroupLevel : null,
    peerGroupNodeId: typeof b.peerGroupNodeId === "string" ? b.peerGroupNodeId : null,
    peerGroupLabel: typeof b.peerGroupLabel === "string" ? b.peerGroupLabel : null,
    category: typeof b.category === "string" ? b.category : null,
    coarseGroup: typeof b.coarseGroup === "string" ? b.coarseGroup : null,
    source: isClassificationSource(b.source) ? b.source : null,
    updatedAt: typeof b.updatedAt === "string" ? b.updatedAt : null,
    peers: b.peers.map(normalizePeer),
    warnings: b.warnings.map(String),
  };
}
