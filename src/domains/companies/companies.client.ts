import { AppError } from "@/shared/errorHandler.js";
import { requireEnv } from "@/shared/env.js";
import type { Company } from "@/domains/companies/companies.types.js";

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

/**
 * Fetches the symbol -> company name reference table from oingg-analysis-ts's `/companies` endpoint
 * (TWSE-listed only, per analysis-ts) — a flat top-level array, not wrapped in an envelope object like
 * `/filters`'s `{ categories, columnPresets }`.
 */
export async function fetchCompanies(): Promise<Company[]> {
  const url = new URL("/companies", requireEnv("FILTERS_SERVICE_URL"));

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
  if (!isCompanyArray(body)) {
    throw new AppError(`Companies endpoint response at ${url.toString()} isn't an array of companies`, 502);
  }

  return body;
}
