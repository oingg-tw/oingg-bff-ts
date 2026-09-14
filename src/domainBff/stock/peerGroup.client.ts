import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { PeerGroupClassificationLevel, PeerGroupCompany, PeerGroupResult } from "@/domainBff/stock/peerGroup.types.js";

function isClassificationLevel(value: unknown): value is PeerGroupClassificationLevel {
  return value === "category" || value === "coarseGroup";
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
  minConfidence?: number;
  minSampleSize?: number;
}

/**
 * Fetches a symbol's supply-chain-derived peer group from analysis-ts's GET /companies/peer-group —
 * see peerGroup.types.ts's PeerGroupResult for the full shape/behavior notes. `minPeers`/`minConfidence`/
 * `minSampleSize` are optional; analysis-ts applies its own defaults (3/0.6/1) when omitted, so bff-ts
 * doesn't hardcode them here either — an unset param here means "let analysis-ts decide."
 */
export async function fetchPeerGroup(symbol: string, params: PeerGroupParams = {}): Promise<PeerGroupResult> {
  const searchParams: Record<string, string> = { symbol };
  if (params.minPeers !== undefined) {
    searchParams.minPeers = String(params.minPeers);
  }
  if (params.minConfidence !== undefined) {
    searchParams.minConfidence = String(params.minConfidence);
  }
  if (params.minSampleSize !== undefined) {
    searchParams.minSampleSize = String(params.minSampleSize);
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
    confidence: typeof b.confidence === "number" ? b.confidence : null,
    sampleSize: typeof b.sampleSize === "number" ? b.sampleSize : null,
    updatedAt: typeof b.updatedAt === "string" ? b.updatedAt : null,
    peers: b.peers.map(normalizePeer),
    warnings: b.warnings.map(String),
  };
}
