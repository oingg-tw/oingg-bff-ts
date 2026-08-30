/**
 * Seeds PresetTemplate with the 21 named strategy templates recommended by the competitor-research
 * report (oingg-conductor-ts/docs/compass_artifact_wf-3e795a7d-..., 2026-08-30): guru strategies,
 * quantitative factors, Taiwan-specific chip/flow signals, and dividend/theme screens, as a
 * discoverability aid matching how incumbents (GuruFocus, Zacks, Stock Rover, CMoney...) structure
 * their preset libraries.
 *
 * `filters` uses real, verified ANALYSIS_METRIC_TABLES field refs for status: "AVAILABLE" templates.
 * About two-thirds are "PENDING" — the report's suggested conditions depend on data this ecosystem
 * doesn't compute anywhere yet:
 *   - Chip/institutional data (三大法人買賣超、融資融券、大戶持股、主力進出) — no service in the
 *     oingg ecosystem ingests or computes this at all yet.
 *   - Point-in-time price/volume technicals (52-week-high distance, moving-average crossovers,
 *     volume) — analysis-ts's catalog is fundamentals/ratios; the screener also can't compare one
 *     metric against another (e.g. "price > moving average") — only a metric against a literal
 *     threshold — so these need both new data AND a screener capability that doesn't exist yet.
 *   - Derived scores this repo hasn't verified a real backing computation for (NNWC, PEG, Magic
 *     Formula's combined EBIT/EV+ROIC ranking, monthly-revenue YoY/MoM, industry grouping/comparison).
 * Re-run this whenever a pending template's blocking data/capability actually ships — update its
 * status/filters/pendingReason here rather than leaving it stale.
 *
 * Idempotent: upserts by `name` (unique), safe to re-run after editing.
 *
 * Run with: pnpm run seed:preset-templates
 */
import "dotenv/config";
import { getPrismaClient, closePrismaClient } from "../src/adapters/neon/prismaClient.js";
import type { PresetTemplateFilter } from "../src/domains/presetTemplates/presetTemplates.types.js";

interface TemplateSeed {
  name: string;
  category: string;
  description: string;
  tier: "FREE" | "PAID";
  status: "AVAILABLE" | "PENDING";
  pendingReason: string | null;
  filters: PresetTemplateFilter[];
}

function filter(field: string, min: number | null, max: number | null): PresetTemplateFilter {
  return { field, min, max, exclude: false };
}

const TEMPLATES: TemplateSeed[] = [
  {
    name: "巴菲特護城河",
    category: "大師策略",
    description:
      "找長期穩健、體質健康的高品質公司——波克夏選股邏輯的簡化版。ROE／營業利益率／負債比用最新一期（TTM）數值，不是原始定義強調的多年平均，數值僅供參考起點。",
    tier: "FREE",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [
      filter("roe.roeTtmPct", 15, null),
      filter("debtRatio.debtRatioPct", null, 50),
      filter("operatingMargin.operatingMarginTtm", 10, null),
      filter("fcfPerShare.fcfPerShareTtm", 0, null),
    ],
  },
  {
    name: "葛拉漢價值股",
    category: "大師策略",
    description: "便宜又體質健全的公司——葛拉漢式的防禦型價值投資篩選。",
    tier: "FREE",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [
      filter("pbr.pbRatio", null, 1.5),
      filter("per.peRatio", null, 15),
      filter("debtRatio.debtRatioPct", null, 50),
      filter("currentRatio.currentRatioPct", 150, null),
    ],
  },
  {
    name: "葛拉漢 Net-Net 深度價值",
    category: "大師策略",
    description: "股價低於淨流動資產價值（NNWC）的極端便宜股，葛拉漢最保守的價值投資法。",
    tier: "PAID",
    status: "PENDING",
    pendingReason:
      "需要 NNWC（現金及約當現金＋0.75×應收款＋0.5×存貨－總負債，再除以股數）逐股計算，目前分析服務沒有這個指標。",
    filters: [],
  },
  {
    name: "Magic Formula 神奇公式",
    category: "大師策略",
    description: "Greenblatt 的神奇公式——高盈餘殖利率（EBIT/EV）與高資本報酬率（ROIC）排名後合併選股。",
    tier: "PAID",
    status: "PENDING",
    pendingReason: "需要 EBIT/EV 與 ROIC 排名後合併計分，目前 screener 只支援單一指標門檻篩選，沒有排名/合併計分機制。",
    filters: [],
  },
  {
    name: "彼得林區成長價值",
    category: "大師策略",
    description: "GARP（合理價格成長股）——本益成長比（PEG）合理、營收與獲利同步成長、財務穩健。",
    tier: "FREE",
    status: "PENDING",
    pendingReason: "PEG（本益比÷盈餘成長率）需要盈餘成長率指標，目前分析服務沒有直接計算這個成長率欄位。",
    filters: [],
  },
  {
    name: "CANSLIM 成長飛行",
    category: "大師策略",
    description: "歐尼爾 CANSLIM 動能成長法——高盈餘成長、股價靠近高點、法人與大盤同步偏多。",
    tier: "PAID",
    status: "PENDING",
    pendingReason: "需要股價距52週高點、三大法人買超天數、大盤站上季線，這些是價量技術面與法人籌碼資料，目前生態系都還沒有。",
    filters: [],
  },
  {
    name: "Piotroski 品質濾網",
    category: "量化因子",
    description: "Piotroski F-Score ≥7——用9項財務體質指標交叉驗證，避開價值陷阱、聚焦真正在好轉的公司。",
    tier: "PAID",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [filter("piotroskiFScore.score", 7, null)],
  },
  {
    name: "Altman Z-Score 安全濾網",
    category: "量化因子",
    description: "Altman Z-Score >2.6——破產風險模型的安全區，適合當其他策略的體質過濾網。",
    tier: "PAID",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [filter("altmanZScore.zScore", 2.6, null)],
  },
  {
    name: "高股息品質因子",
    category: "量化因子",
    description: "高殖利率再疊加獲利品質，避免只看殖利率、忽略體質正在惡化的股息陷阱股。",
    tier: "FREE",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [filter("dividendYield.dividendYieldPct", 5, null), filter("roe.roeTtmPct", 10, null)],
  },
  {
    name: "動能因子（相對強弱）",
    category: "量化因子",
    description: "股價相對強勢、靠近波段高點且量能放大——短中期動能選股。",
    tier: "FREE",
    status: "PENDING",
    pendingReason: "需要股價距52週高點、近期均量等價量技術指標，分析服務目前以財報比率為主，還沒有這類技術面資料。",
    filters: [],
  },
  {
    name: "低波動穩健",
    category: "量化因子",
    description: "保守型資產配置用——用 Beta 篩出相對大盤波動較小的個股（沒有直接的股價年化波動率指標，Beta 是目前可用的代理指標）。",
    tier: "PAID",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [filter("beta.beta1Y", null, 0.8)],
  },
  {
    name: "三大法人連續買超",
    category: "台股籌碼面",
    description: "外資／投信／自營商合計連續買超的股票——籌碼面偏多訊號。",
    tier: "FREE",
    status: "PENDING",
    pendingReason: "三大法人買賣超屬於籌碼面資料，目前整個 oingg 生態系都還沒有服務在擷取或計算這類資料。",
    filters: [],
  },
  {
    name: "融資賣壓中小型股",
    category: "台股籌碼面",
    description: "融資餘額偏高、籌碼不穩定的中小型股——風險提示用，非做多建議。",
    tier: "PAID",
    status: "PENDING",
    pendingReason: "融資融券餘額屬於籌碼面資料，目前生態系尚未建置。",
    filters: [],
  },
  {
    name: "主力出貨警示",
    category: "台股籌碼面",
    description: "法人籌碼與股價走勢出現背離、疑似主力出貨的訊號股。",
    tier: "PAID",
    status: "PENDING",
    pendingReason: "主力出貨判斷需要法人籌碼與股價背離的複合訊號，目前生態系尚未有籌碼資料來源。",
    filters: [],
  },
  {
    name: "主力吸貨觀察",
    category: "台股籌碼面",
    description: "法人籌碼轉為連續買超、股價同步上漲的疑似主力吸貨股。",
    tier: "PAID",
    status: "PENDING",
    pendingReason: "同樣需要法人籌碼資料，目前生態系尚未建置。",
    filters: [],
  },
  {
    name: "大戶籌碼集中",
    category: "台股籌碼面",
    description: "大戶（超過400張）持股比例持續增加的股票，反映主力資金卡位。",
    tier: "PAID",
    status: "PENDING",
    pendingReason: "大戶持股集中度屬於股權分散表資料，目前生態系尚未建置。",
    filters: [],
  },
  {
    name: "營收動能",
    category: "台股籌碼面",
    description: "台股特色的月營收 YoY/MoM 動能篩選——用每月10日公告的營收數字提前捕捉基本面轉折。",
    tier: "FREE",
    status: "PENDING",
    pendingReason: "月營收 YoY/MoM 是原始月營收資料的衍生計算，分析服務目前的指標目錄裡沒有涵蓋月營收動能類指標。",
    filters: [],
  },
  {
    name: "存股高股息",
    category: "存股主題",
    description: "長期穩健、適合存股的高股息標的——殖利率、獲利品質、配息可持續性一起看。",
    tier: "FREE",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [
      filter("dividendYield.dividendYieldPct", 5, null),
      filter("roe.roeTtmPct", 10, null),
      filter("dividendPayoutRatio.payoutRatioTtm", null, 100),
    ],
  },
  {
    name: "除權息貼息股",
    category: "存股主題",
    description: "除權息後長期填不了息的股票——存股前的風險提示清單。",
    tier: "PAID",
    status: "PENDING",
    pendingReason: "填息追蹤需要除權息事件與事後股價歷史比對，目前分析服務沒有這類事件式資料。",
    filters: [],
  },
  {
    name: "排除地雷股",
    category: "存股主題",
    description: "排除 KY 股、財報遭警示等高風險標的，適合當任何策略的最後一道防線。",
    tier: "FREE",
    status: "PENDING",
    pendingReason: "是否為 KY 股、財報是否遭警示，屬於公司屬性標記資料，目前生態系尚未建置。",
    filters: [],
  },
  {
    name: "產業龍頭主題",
    category: "存股主題",
    description: "依產業分類挑出市值/獲利能力領先的龍頭股，做產業輪動或主題投資用。",
    tier: "PAID",
    status: "PENDING",
    pendingReason:
      "需要依產業分類分組比較，是分組排名功能，跟目前 screener 的單一門檻篩選機制不同；產業分類資料也還沒接入 filterCatalog。",
    filters: [],
  },
];

async function main() {
  const prisma = getPrismaClient();

  for (const [index, template] of TEMPLATES.entries()) {
    await prisma.presetTemplate.upsert({
      where: { name: template.name },
      create: { ...template, position: index },
      update: { ...template, position: index },
    });
  }

  console.log(`Seeded ${TEMPLATES.length} preset templates.`);
  const available = TEMPLATES.filter((t) => t.status === "AVAILABLE").length;
  console.log(`  ${available} AVAILABLE, ${TEMPLATES.length - available} PENDING.`);
}

main()
  .catch((error: unknown) => {
    console.error("Seeding preset templates failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePrismaClient();
  });
