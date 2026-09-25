import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailKind } from "@/application/ports/emailGateway.js";

const ALL_KINDS: EmailKind[] = ["expiryReminder", "preChargeNotice", "paymentReceipt", "refundConfirmed", "priceChangeNotice"];

/**
 * 每個測試都拿一份新的 module，因為冪等用的是模組層的 Map——共用實例會讓第二個測試看到第一個測試的鍵，
 * 那種互相污染在「為什麼單獨跑會過、一起跑會掛」時很難查。
 */
async function freshClient() {
  vi.resetModules();
  const { createResendEmailClient } = await import("@/infrastructure/email/resendEmailClient.js");
  return createResendEmailClient();
}

function okResponse(id = "msg_1") {
  return new Response(JSON.stringify({ id }), { status: 200, headers: { "Content-Type": "application/json" } });
}

/**
 * 明確標上 fetch 的參數型別。`vi.fn(async () => ...)` 的參數會被推成空 tuple，於是 `mock.calls[0][1]`
 * 在 tsc 眼裡不存在——測試照樣會綠，但 `npm run typecheck` 會紅。
 */
type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];
const fetchStub = (impl: (...args: FetchArgs) => Promise<Response>) => vi.fn(impl);
const initOf = (call: FetchArgs | undefined): RequestInit => call?.[1] ?? {};

describe("resendEmailClient", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "billing@example.test";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.EMAIL_FROM;
  });

  /**
   * **這個測試守的是法律界線，不是格式。** 付費牆只能鎖查詢廣度／歷史深度／匯出推播；一封夾帶標的或
   * 選股結論的信是「報酬＋推介建議」，構成投信投顧法 §4 的要件。型別擋得住呼叫端塞自由文字，擋不住
   * 有人把推薦寫進模板裡——所以這裡逐封檢查渲染結果。
   *
   * 新增 EmailKind 時 ALL_KINDS 要跟著加，這個測試就會逼新模板也通過同一組檢查。
   */
  it("沒有任何一種信含個股代號或推介用語", async () => {
    const client = await freshClient();
    const fetchMock = fetchStub(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    for (const kind of ALL_KINDS) {
      await client.send({
        to: "user@example.test",
        kind,
        variables: { displayName: "陳先生", periodEndDate: "2026-12-31", daysUntilExpiry: 7, amountTwd: 3990, tier: "PRO" },
        idempotencyKey: `k-${kind}`,
      });
      const body = JSON.parse(String(initOf(fetchMock.mock.calls.at(-1)).body));
      const whole = `${body.subject}\n${body.text}`;

      for (const banned of ["推薦", "建議買", "買進", "賣出", "目標價", "精選", "看好", "潛力股", "明牌"]) {
        expect(whole, `${kind} 含推介用語「${banned}」`).not.toContain(banned);
      }
      // 反向確認這個測試有在看東西：內容必須真的提到訂閱或帳務，不是空字串通過。
      expect(whole.length).toBeGreaterThan(40);
      expect(whole).toMatch(/訂閱|方案|付款|退費|續扣/);
    }
    expect(fetchMock).toHaveBeenCalledTimes(ALL_KINDS.length);
  });

  /**
   * 四碼股號要對**模板自己的文字**驗，不是對渲染結果驗——渲染結果裡的 `2026-12-31` 與金額 `3990` 都是
   * 合法的四位數，第一版寫成驗渲染結果就被自己的日期判成違規。不帶任何變數渲染之後，剩下的四位數只可能
   * 來自模板字面，那才是「有人把 2330 寫進信裡」真正會現形的地方。
   */
  it("模板字面沒有四碼股票代號", async () => {
    const client = await freshClient();
    const fetchMock = fetchStub(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    for (const kind of ALL_KINDS) {
      await client.send({ to: "u@example.test", kind, variables: {}, idempotencyKey: `bare-${kind}` });
      const body = JSON.parse(String(initOf(fetchMock.mock.calls.at(-1)).body));
      const whole = `${body.subject}\n${body.text}`;
      expect(whole, `${kind} 的模板字面出現了看起來像股票代號的四位數`).not.toMatch(/(?<!\d)[1-9]\d{3}(?!\d)/);
    }
  });

  it("同一把冪等鍵只會真的寄一次", async () => {
    const client = await freshClient();
    const fetchMock = fetchStub(async () => okResponse("msg_dedupe"));
    vi.stubGlobal("fetch", fetchMock);

    const input = {
      to: "user@example.test",
      kind: "expiryReminder" as const,
      variables: { periodEndDate: "2026-12-31", daysUntilExpiry: 30 },
      idempotencyKey: "uid-1:expiryReminder:2026-12-31",
    };
    const first = await client.send(input);
    const second = await client.send(input);

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.providerMessageId).toBe(first.providerMessageId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 供應商端也要收到同一把鍵——程序內的 Map 重啟就沒了，這個標頭是跨重啟的第二層。
    expect(new Headers(initOf(fetchMock.mock.calls[0]).headers).get("Idempotency-Key")).toBe(input.idempotencyKey);
  });

  it("到期天數決定語氣，但三種都寫出日期", async () => {
    const client = await freshClient();
    const fetchMock = fetchStub(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const texts: string[] = [];
    for (const days of [30, 7, 1]) {
      await client.send({
        to: "u@example.test",
        kind: "expiryReminder",
        variables: { periodEndDate: "2026-12-31", daysUntilExpiry: days },
        idempotencyKey: `d-${days}`,
      });
      texts.push(JSON.parse(String(initOf(fetchMock.mock.calls.at(-1)).body)).text);
    }
    expect(new Set(texts).size, "三個節奏的文案應該不同，否則 30/7/1 沒有意義").toBe(3);
    for (const t of texts) expect(t).toContain("2026-12-31");
    // 降級說明必須在每一封裡：這族群沒收到信就是無預警降級，而降級消失的是廣度不是分析內容。
    for (const t of texts) expect(t).toContain("免費方案");
  });

  it("供應商回非 2xx 時丟 502，而且不把收件地址寫進錯誤訊息", async () => {
    const client = await freshClient();
    vi.stubGlobal("fetch", fetchStub(async () => new Response("rate limited", { status: 429 })));

    await expect(
      client.send({ to: "secret@example.test", kind: "paymentReceipt", variables: {}, idempotencyKey: "e-1" }),
    ).rejects.toMatchObject({ statusCode: 502 });

    await expect(
      client.send({ to: "secret@example.test", kind: "paymentReceipt", variables: {}, idempotencyKey: "e-2" }),
    ).rejects.not.toThrow(/secret@example\.test/);
  });

  it("連不上供應商時丟 502 而不是讓 fetch 的錯誤冒上去", async () => {
    const client = await freshClient();
    vi.stubGlobal("fetch", fetchStub(async () => { throw new Error("ECONNREFUSED"); }));

    await expect(
      client.send({ to: "u@example.test", kind: "refundConfirmed", variables: { amountTwd: 3990 }, idempotencyKey: "n-1" }),
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  it("失敗的寄送不會佔用冪等鍵", async () => {
    const client = await freshClient();
    const fetchMock = fetchStub(async () => okResponse("msg_retry"))
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(okResponse("msg_retry"));
    vi.stubGlobal("fetch", fetchMock);

    const input = { to: "u@example.test", kind: "expiryReminder" as const, variables: { periodEndDate: "2026-12-31" }, idempotencyKey: "retry-1" };
    await expect(client.send(input)).rejects.toMatchObject({ statusCode: 502 });
    // 若失敗也記進 Map，重試就會被當成「已寄過」而永遠不會送出——那是漏寄而不是重複寄，更難發現。
    const retried = await client.send(input);
    expect(retried.deduplicated).toBe(false);
    expect(retried.providerMessageId).toBe("msg_retry");
  });
});
