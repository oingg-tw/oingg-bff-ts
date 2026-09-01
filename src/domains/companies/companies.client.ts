import { AppError } from "@/shared/errorHandler.js";
import { requireEnv } from "@/shared/env.js";
import type { Company } from "@/domains/companies/companies.types.js";

// analysis-ts's hard technical cap per request (their choice, not ours) — using it (rather than their
// smaller default of 200) minimizes round trips when paging through the whole list.
const PAGE_LIMIT = 1000;

interface PagedCompaniesResponse {
  count: number;
  entries: Company[];
}

function isCompanyArray(value: unknown): value is Company[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Company).companyId === "string" &&
        ((item as Company).companyName === null || typeof (item as Company).companyName === "string"),
    )
  );
}

function isPagedCompaniesResponse(value: unknown): value is PagedCompaniesResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as { count?: unknown; entries?: unknown };
  return typeof v.count === "number" && isCompanyArray(v.entries);
}

async function fetchCompaniesPage(offset: number): Promise<PagedCompaniesResponse> {
  const url = new URL("/companies", requireEnv("FILTERS_SERVICE_URL"));
  url.searchParams.set("limit", String(PAGE_LIMIT));
  url.searchParams.set("offset", String(offset));

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new AppError(
      `Could not reach the analysis service at ${url.toString()}: ${error instanceof Error ? error.message : String(error)}`,
      502,
    );
  }

  if (!response.ok) {
    throw new AppError(`Companies endpoint returned ${response.status} for ${url.toString()}`, 502);
  }

  const body: unknown = await response.json();
  if (!isPagedCompaniesResponse(body)) {
    throw new AppError(`Companies endpoint response at ${url.toString()} is missing count/entries`, 502);
  }

  return body;
}

/**
 * Fetches the symbol -> company name reference table from oingg-analysis-ts's `/companies` endpoint
 * (TWSE+TPEx). analysis-ts added pagination here (2026-09-01, `{ count, limit, offset, entries }` instead
 * of a flat array) without a transition period — `limit` is capped at 1000/defaults to 200 on their side
 * (a technical cap they own, not something we request), so a full sync now needs multiple round trips.
 * Loops until every entry up to `count` has been collected, using the largest allowed page size to
 * minimize round trips (currently ~2,650 companies -> 3 requests). `count` is re-read each page rather
 * than cached from the first response, in case it shifts slightly mid-fetch (this is reference data that
 * changes a few times a year per analysis-ts — an inconsistent read here is a low-risk, low-cost
 * possibility, not worth a snapshot/cursor mechanism).
 */
export async function fetchCompanies(): Promise<Company[]> {
  const all: Company[] = [];
  let offset = 0;

  for (;;) {
    const page = await fetchCompaniesPage(offset);
    all.push(...page.entries);
    offset += page.entries.length;
    if (page.entries.length === 0 || offset >= page.count) {
      break;
    }
  }

  return all;
}
