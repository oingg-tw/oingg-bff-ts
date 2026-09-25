/**
 * 寄信 port。實作住 infrastructure/email/resendEmailClient.ts。
 *
 * **為什麼收的是列舉的信件種類而不是 subject/body**：付費牆只能鎖三件事，「匯出／推播效率」是其中一件，
 * 所以信本身是付費功能——但一封夾帶標的或分析意見的信是「報酬＋推介建議」，正好構成投信投顧法 §4 的
 * 要件（§107 是 5 年以下有期徒刑、罰金 100 萬至 5,000 萬）。允許的是帳務與生命週期，不允許的是任何
 * 選股結論。
 *
 * 這個界線不能靠記性守，也**不是供應商能幫你守的**——Resend／Postmark 的 transactional 與 broadcast
 * 分流是投遞率與 IP 信譽的機制，不會阻止任何人在到期提醒信結尾加一句「順便推薦 2330」。所以界線做在
 * 型別上：呼叫端給不出自由文字，只能選一種已經審過的信，內容由 infrastructure 層的模板決定。
 *
 * 要加新的信件種類，就是在 EmailKind 加一個成員並補模板——那一刻正是該重讀上面那段的時候。編譯器擋不住
 * 一個叫 `weeklyPicks` 的成員被加進去，但它會讓那個決定是刻意的、留在 diff 裡、而且看得到這段註解。
 */

/**
 * 可以寄的信。**每一種都只講帳務與訂閱狀態，都不含任何個股、選股結果或分析意見。**
 *
 * - `expiryReminder`：到期前提醒。MANUAL 續約的人沒收到這封就是無預警降級（AUTOMATIC 的人會被自動
 *   扣款，不靠這封信），節奏 30/7/1 見 docs/訂閱生命週期規格.md §2。
 * - `preChargeNotice`：AUTOMATIC 扣款前通知。台灣目前無強制事前通知義務，這是針對「不知情被扣」這個
 *   客訴來源的信任設計。
 * - `paymentReceipt`：扣款／付款成功。
 * - `refundConfirmed`：退費完成（七天解約權，見規格 §5）。
 * - `priceChangeNotice`：調價通知，需提前 60 天，內容要寫明舊價保留的結束日。
 */
export type EmailKind =
  | "expiryReminder"
  | "preChargeNotice"
  | "paymentReceipt"
  | "refundConfirmed"
  | "priceChangeNotice";

/** 模板要填的值。刻意全是純量：沒有地方可以塞一段自由文案進去。 */
export interface EmailVariables {
  /** 收件人怎麼被稱呼。沒有就用中性稱呼，不要硬塞 email 前綴。 */
  displayName?: string;
  /** 期間結束日，`YYYY-MM-DD`。expiryReminder / preChargeNotice / priceChangeNotice 用。 */
  periodEndDate?: string;
  /** 距離到期還有幾天，用來選 30/7/1 的文案。 */
  daysUntilExpiry?: number;
  /** 金額（新台幣元，整數）。paymentReceipt / refundConfirmed / priceChangeNotice 用。 */
  amountTwd?: number;
  /** 方案名稱，例如 "PRO"。 */
  tier?: string;
}

export interface SendEmailInput {
  /** 收件地址。一封一個人——這個 port 沒有群發，群發不屬於帳務信。 */
  to: string;
  kind: EmailKind;
  variables: EmailVariables;
  /**
   * 冪等鍵。同一把鍵重複呼叫必須只寄出一次。
   *
   * 排程器會重試（Cloud Scheduler 逾時就重送），而「提醒信重複寄三封」對一個預設「要錢的都是詐騙」的
   * 族群，傷害比漏寄更大。建議用 `<firebaseUid>:<kind>:<periodEndDate>` 這種自然鍵，不要用時間戳。
   */
  idempotencyKey: string;
}

export interface SendEmailResult {
  /** 供應商端的訊息 id，用來對帳與查投遞狀態。 */
  providerMessageId: string;
  /** true 表示這把冪等鍵先前已經寄過，這次沒有真的送出。 */
  deduplicated: boolean;
}

export interface EmailGatewayPort {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
