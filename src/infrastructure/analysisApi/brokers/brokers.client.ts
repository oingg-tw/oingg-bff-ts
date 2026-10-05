import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { Broker, BrokerList } from "@/application/proxy/brokers/brokers.types.js";
import type { BrokersGatewayPort } from "@/application/ports/brokersGateway.js";

function contractError(field: string): AppError {
  logger.error({ field }, "Brokers response violates its contract — likely an upstream change bff-ts has not followed");
  return new AppError(`Brokers response has an invalid ${field}`, 502);
}

/**
 * 逐欄位正規化。brokerCode 與 shortName 是下拉選單的值與顯示文字，缺了就是契約被破壞——回 502 指名
 * 欄位，而不是送出一個空字串選項讓使用者選到一家「沒有名字的券商」。name 目前一律 null（來源只有簡稱）。
 */
function normalizeBroker(raw: unknown): Broker {
  const r = raw as Record<string, unknown>;
  if (typeof r.brokerCode !== "string" || r.brokerCode === "") {
    throw contractError("brokers[].brokerCode");
  }
  if (typeof r.shortName !== "string" || r.shortName === "") {
    throw contractError("brokers[].shortName");
  }
  return { brokerCode: r.brokerCode, name: typeof r.name === "string" ? r.name : null, shortName: r.shortName };
}

/**
 * analysis-ts 的 GET /brokers（2026-10-05 新增）。純轉發、零計算、不帶參數。
 * 實測（2026-10-05）：60 家、asOfDate "2026-10-04"、依代號排序且不重複、name 全是 null。
 */
export async function fetchBrokers(): Promise<BrokerList> {
  const url = buildAnalysisServiceUrl("/brokers", {});
  const response = await fetchAnalysisService(url);
  await assertAnalysisServiceOk(response, url, "Brokers endpoint");

  const body = (await response.json()) as Record<string, unknown>;
  if (!Array.isArray(body.brokers)) {
    throw contractError("brokers");
  }
  return {
    asOfDate: typeof body.asOfDate === "string" ? body.asOfDate : null,
    brokers: body.brokers.map(normalizeBroker),
  };
}

export const analysisBrokersGateway: BrokersGatewayPort = { getBrokers: fetchBrokers };
