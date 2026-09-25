/**
 * 從心理計量分布抽樣產生 persona（跟 retiree-personas.json / extended-personas.json 是不同性質的東西）。
 *
 * 手寫 persona 的根本限制：作者只寫得出「有特色」的人。真實母體大部分平凡，而平凡的那一段恰好是
 * 決定營收的那一段。這支腳本改成從分布抽，所以：
 *   - 每一位是獨立抽樣，不是同一個作者的變體
 *   - 會自然產生一堆不好寫、也不好記的中間值
 *   - 換 seed 就是另一組樣本，N 可調，過程可重現
 *
 * **用它產生輸入的變異，不要用它宣稱輸出的效度。** LLM 扮演這些 persona 時仍然會往平均回歸，
 * 抽樣只保證「給模型的設定是分散的」，不保證「模型的回答是分散的」。
 * persona-cognitive-profiles.md §3 的塌縮檢查照樣要做。
 *
 * 用法：node docs/pricing-research/generate-sampled-personas.mjs [N] [seed] > sampled-personas.json
 */

// ---------------------------------------------------------------------------
// 參數來源與可信度。**這裡沒有一個數字是為了好看湊的，但精度差異很大，分開標示：**
//
// [實證] 有文獻支持的方向與大致量級：
//   - 年齡效應：進入中老年後 C 與 A 上升、N 下降、E 與 O 略降。
//   - 性別差異：女性平均 N 與 A 較高。
//   - 特質與財務行為：O/C/E 正向影響風險承受度，N 負向；C 是儲蓄與淨值最強的正向預測因子；
//     N 帶來風險趨避與財務焦慮；O 帶來嘗試新事物的意願；A 偏向保守的家庭安全取向。
//     這些關係在控制收入、教育與財務知識之後仍然存在。
//
// [近似] 相關矩陣用的是常見的後設分析量級，不是特定某份研究的精確值。
//
// [假設] 特質 → 行為參數的**係數**（下面 derive() 裡的權重）是我依上述方向訂的，
//   文獻給的是方向與顯著性，不是可直接搬用的迴歸係數。**任何依賴這些係數精確值的結論都不成立**，
//   它們的用途只是讓抽出來的人彼此不同且方向合理。
// ---------------------------------------------------------------------------

const BIG_FIVE = ["O", "C", "E", "A", "N"];

/** [近似] 常見後設分析量級的五因素相關矩陣，順序同 BIG_FIVE。 */
const CORR = [
  [1.0, 0.1, 0.3, 0.1, -0.1],
  [0.1, 1.0, 0.2, 0.25, -0.25],
  [0.3, 0.2, 1.0, 0.2, -0.25],
  [0.1, 0.25, 0.2, 1.0, -0.2],
  [-0.1, -0.25, -0.25, -0.2, 1.0],
];

/** [實證] 55 歲以上相對於一般成年母體的平均位移，單位是 SD。量級刻意保守。 */
const AGE_SHIFT = { O: -0.25, C: 0.25, E: -0.15, A: 0.3, N: -0.3 };
/** [實證] 女性相對男性的平均位移，單位是 SD。 */
const FEMALE_SHIFT = { O: 0.0, C: 0.05, E: 0.1, A: 0.25, N: 0.35 };

// ---------------------------------------------------------------------------
// Schwartz 價值排序：從 traits 推導，不是另外抽樣。
//
// 為什麼是正弦而不是 5×10 的係數表：Parks-Leduc 等人的後設分析（60 篇研究）發現特質與價值的相關
// 沿著 Schwartz 的價值環呈**正弦形**——一個清楚的峰、一個清楚的谷，繞著環單調升降，開放性與友善性
// 尤其明顯。所以每個特質只需要「峰值位置 + 振幅」兩個參數，而不是 50 個各自可疑的係數。少 25 倍的
// 自由參數，而且形狀是文獻測到的而非我配的。
//
// [實證] 峰值位置與振幅取自後設分析報告的相關量級：
//   A → 仁慈 ρ=.61（全表最強），普世 .39，權力 −.42  → 峰在 benevolence，振幅最大
//   O → 自我導向 ρ=.37，普世為正                      → 峰在 selfDirection
//   C → 安全 ρ=.37、從眾 .27、成就 .17                → 峰落在 security 與 conformity 之間
//   E → 刺激／享樂／成就／權力為正，傳統為負          → 峰在 hedonism 附近，谷正好在 tradition
//   N → **與價值幾乎無相關**，所以振幅為 0
//
// 最後一條是刻意的：情緒穩定性在後設分析裡對價值沒有解釋力，硬給它一個方向就是憑空造訊號。
// 代價是這 60 位的價值排序只由 O/C/E/A 四個維度決定，N 只影響行為參數（見 derive()）。
//
// **這是母體層級的相關，量級中等。** 個別 persona 推出來的排序是一個合理的抽樣，不是對這個人的測量；
// 手寫的 20 位是逐句找證據排出來的，性質不同，不要混著當同一種資料用。
// ---------------------------------------------------------------------------

/** Schwartz 的環狀順序，相鄰相容、相隔 5 格對立。 */
const VALUE_CIRCLE = [
  "selfDirection", "stimulation", "hedonism", "achievement", "power",
  "security", "conformity", "tradition", "benevolence", "universalism",
];

/** [實證] 峰值在環上的位置（可為小數，代表落在兩個價值之間）與振幅。 */
const VALUE_LOADING = {
  O: { peak: 0.0, amp: 0.37 },
  C: { peak: 5.5, amp: 0.32 },
  E: { peak: 2.5, amp: 0.25 },
  A: { peak: 8.0, amp: 0.5 },
  N: { peak: 0.0, amp: 0.0 },
};

/**
 * [實證] 特質解釋不掉的個體差異。**這一項不是把數字弄漂亮，它是必要的，理由有兩層：**
 *
 * 第一層是文獻：最強的相關是 A↔仁慈 ρ=.61，也就是只解釋約 37% 的變異；其餘多在 .2–.4，解釋不到
 * 兩成。特質能決定一個人價值排序的傾向，決定不了排序本身。把投影直接當排序，等於宣稱 r=1。
 *
 * 第二層是實測，而且是這支腳本自己測出來的：沒有這一項時 60 位只產生 **17 種互異的排序**。原因是
 * 同頻率正弦疊加後仍是單一正弦，所以四個特質最後只決定「一個相位」，排序退化成「從峰值往兩側展開」，
 * 10 個離散位置就只有十幾種可能。振幅設多大都救不了——那是三角恆等式，不是參數沒調好。
 *
 * 比例定在特質約佔四分之一的變異（σ_ε ≈ 1.7 × 投影本身的典型 SD），對應文獻中等量級的相關。
 */
const VALUE_NOISE_SD = 0.45;

/**
 * 把五個特質分數投影到價值環上，加上個體差異，回傳由高到低的排序。
 * `rand` 走同一條可重現的亂數流，所以換 seed 會換排序、同 seed 永遠一樣。
 */
function deriveValueOrder(t, rand) {
  const scored = VALUE_CIRCLE.map((key, i) => {
    let s = 0;
    for (const trait of BIG_FIVE) {
      const { peak, amp } = VALUE_LOADING[trait];
      if (amp === 0) continue;
      s += t[trait] * amp * Math.cos((2 * Math.PI * (i - peak)) / VALUE_CIRCLE.length);
    }
    return { key, s: s + normal(rand) * VALUE_NOISE_SD };
  });
  // 同分時用環上的位置當穩定的第二鍵，否則換 node 版本可能換順序
  scored.sort((a, b) => b.s - a.s || VALUE_CIRCLE.indexOf(a.key) - VALUE_CIRCLE.indexOf(b.key));
  return scored.map((x) => x.key);
}

// --- 可重現的亂數（mulberry32）與常態抽樣（Box-Muller） -------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(rand) {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
/** Cholesky 分解，用來把獨立常態變成有相關結構的常態。 */
function cholesky(m) {
  const n = m.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let s = 0;
      for (let k = 0; k < j; k += 1) s += L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(m[i][i] - s) : (m[i][j] - s) / L[j][j];
    }
  }
  return L;
}
const L = cholesky(CORR);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];

function sampleTraits(rand, isFemale) {
  const z = BIG_FIVE.map(() => normal(rand));
  const correlated = L.map((row) => row.reduce((acc, coef, k) => acc + coef * z[k], 0));
  return Object.fromEntries(
    BIG_FIVE.map((t, i) => [t, round1(correlated[i] + AGE_SHIFT[t] + (isFemale ? FEMALE_SHIFT[t] : 0))]),
  );
}

/**
 * [假設] 特質 → 行為參數。方向取自文獻，權重是設定值。
 * 收入刻意獨立於特質抽樣：文獻說特質的解釋力是**在控制收入之後**才成立的，
 * 若讓特質決定收入，就會把兩個本該分開的效果混在一起，最後分不清是誰在驅動願付價格。
 */
function derive(t, ageYears, monthlyIncome) {
  const riskTolerance = clamp(Math.round(3 + 0.6 * t.O + 0.4 * t.E + 0.3 * t.C - 0.8 * t.N), 1, 5);
  const techLiteracy = clamp(Math.round(3.4 + 0.7 * t.O - (ageYears - 62) * 0.06), 1, 5);
  // 對「自動續扣」的抗拒：高 N（怕被扣款不知情）、低 O（不習慣新付款方式）
  const autoRenewAversion = round1(clamp(0.5 + 0.35 * t.N - 0.3 * t.O, 0, 1));
  // 願付上限：收入是主導項，特質是修正項——這個比重關係本身就是結論之一
  const affordableMonthly = Math.round(monthlyIncome * clamp(0.012 + 0.004 * t.O + 0.003 * t.C - 0.004 * t.N, 0.002, 0.03));
  return { riskTolerance, techLiteracy, autoRenewAversion, affordableMonthly };
}

// [近似] 台灣退休族月收入（月退＋股利）取對數常態，中位數約 45k，右尾拉長；
// 這是分布形狀的合理假設，不是取自單一官方統計。
function sampleIncome(rand) {
  return Math.round((45000 * Math.exp(0.55 * normal(rand))) / 1000) * 1000;
}

const CITIES = ["台北", "新北", "桃園", "台中", "台南", "高雄", "彰化", "新竹", "嘉義", "宜蘭"];
const STYLES = ["存股領息", "高股息 ETF", "指數化投資", "金融股存股", "價值選股", "被動持有不操作"];

function makePersona(i, rand) {
  const isFemale = rand() < 0.5;
  const age = Math.round(55 + rand() * 22);
  const traits = sampleTraits(rand, isFemale);
  const monthlyIncome = sampleIncome(rand);
  const derived = derive(traits, age, monthlyIncome);
  return {
    id: `samp-${String(i + 1).padStart(3, "0")}`,
    gender: isFemale ? "女" : "男",
    age,
    city: pick(rand, CITIES),
    traits,
    income: { monthlyTwd: monthlyIncome, monthlyLivingExpenseTwd: Math.round(monthlyIncome * (0.6 + rand() * 0.3)) },
    assets: { investableTwd: Math.round((monthlyIncome * 12 * (2 + rand() * 12)) / 100000) * 100000 },
    investing: { style: pick(rand, STYLES), riskTolerance: derived.riskTolerance },
    digital: { techLiteracy: derived.techLiteracy },
    billing: {
      autoRenewAversion: derived.autoRenewAversion,
      // 抗拒程度高的人偏好一次性年繳（ATM／超商），這條對應的是 MANUAL 續約分支
      prefersOneOffAnnual: derived.autoRenewAversion > 0.6,
    },
    affordableMonthlyTwd: derived.affordableMonthly,
    // 價值排序用**獨立的**亂數流，不共用 rand：共用會改變後續抽樣的消耗順序，讓同一個 seed 產生
    // 完全不同的 60 個人。加一個欄位不該把既有樣本整批換掉，所以這裡由 seed 與序號各自導出。
    values: (() => {
      const order = deriveValueOrder(traits, rng((seed ^ ((i + 1) * 2654435761)) >>> 0));
      return { schema: "schwartz10", order, top3: order.slice(0, 3), bottom2: order.slice(-2), derivedFrom: "traits" };
    })(),
  };
}

const n = Number(process.argv[2] ?? 60);
const seed = Number(process.argv[3] ?? 20260923);
const rand = rng(seed);
const personas = Array.from({ length: n }, (_, i) => makePersona(i, rand));

const mean = (f) => round1(personas.reduce((s, p) => s + f(p), 0) / personas.length);
console.log(
  JSON.stringify(
    {
      $comment:
        "由 generate-sampled-personas.mjs 抽樣產生，不是手寫的。參數來源與可信度分級（實證／近似／假設）寫在該腳本開頭。" +
        "用途是提供輸入的變異與平凡的中間值，不是宣稱輸出有統計效度——LLM 扮演時仍會往平均回歸，塌縮檢查照做。",
      generatedWith: { script: "generate-sampled-personas.mjs", n, seed },
      sanityCheck: {
        note: "抽樣後的實際均值，應該接近上面的位移設定；若明顯偏離代表抽樣或參數有誤。",
        traitMeans: Object.fromEntries(BIG_FIVE.map((t) => [t, mean((p) => p.traits[t])])),
        meanAge: mean((p) => p.age),
        meanAffordableMonthlyTwd: Math.round(personas.reduce((s, p) => s + p.affordableMonthlyTwd, 0) / n),
        prefersOneOffAnnualPct: Math.round((personas.filter((p) => p.billing.prefersOneOffAnnual).length / n) * 100),
        // 價值排序的塌縮檢查：全體年齡位移讓 A 與 C 整體偏高，所以「首位價值」有可能被同一個值吃掉。
        // 若 topValueCounts 只剩一兩個鍵，或 distinctOrders 遠小於 n，那是這個推導模型自己塌縮，
        // 不是母體真的這麼一致——那種情況下這批的價值序不能用來論證分岔。
        topValueCounts: personas.reduce((acc, p) => ({ ...acc, [p.values.order[0]]: (acc[p.values.order[0]] ?? 0) + 1 }), {}),
        distinctTop3: new Set(personas.map((p) => p.values.top3.join(">"))).size,
        distinctOrders: new Set(personas.map((p) => p.values.order.join(">"))).size,
      },
      personas,
    },
    null,
    2,
  ),
);
