import { AppError } from "@/domain/appError.js";
import type { EmailGatewayPort, EmailKind, EmailVariables, SendEmailInput, SendEmailResult } from "@/application/ports/emailGateway.js";
import { EMAIL_TIMEOUT_MS, env, requireEnv } from "@/shared/env.js";
import { logger } from "@/shared/logger.js";

/**
 * EmailGatewayPort 的 Resend 實作。**用 REST 而不是 SDK，也不用 SMTP**，兩個理由：
 *
 * 1. CLAUDE.md 的「不加新 dependency」——一個 POST 用現有的 `fetch` 就夠，`resend` 套件買不到任何東西。
 * 2. Google Cloud 對外封鎖 TCP 25（見 VPC firewall 文件的 Blocked and limited traffic 段，全平台政策、
 *    理由是防垃圾信；465/587 沒封）。走 HTTPS/443 讓這整件事跟我們無關，換供應商也只是換一個 URL。
 *
 * 供應商選擇本身沒有 GCP 背書：GCP 文件點名的是 SendGrid／Mailgun／Mailjet（而且那頁講的是 Compute
 * Engine 與 Cloud Run *functions*，不是 Cloud Run services），Resend 不在其中。要換家的話這個檔案是
 * 唯一要改的地方——port 與呼叫端都不知道 Resend 存在。
 */
const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * 寄件地址。**沒有已驗證網域時 Resend 只允許 `onboarding@resend.dev`，而且只能寄到帳號本人的信箱**，
 * 所以預設值只夠做冒煙測試，不足以寄給真實使用者。
 *
 * 上線前要設成自有網域，並把 SPF／DKIM／DMARC 設好——這不是投遞率的微調而是這個產品的核心風險：
 * persona 資料裡 retiree-04 的第一條抗拒理由就是「要錢的都是詐騙」，retiree-10 的目標之一是「教會朋友
 * 不要被詐騙」。一封驗不過 DKIM 的收費提醒信，在這個族群眼裡跟釣魚信無法區分。
 */
const DEFAULT_FROM = "onboarding@resend.dev";

/** 純量代入，沒有任何一處接受呼叫端給的自由文字——界線見 emailGateway.ts 的說明。 */
function renderTemplate(kind: EmailKind, v: EmailVariables): { subject: string; text: string } {
  const name = v.displayName ?? "您好";
  const tier = v.tier ?? "付費方案";
  const end = v.periodEndDate ?? "";
  const amount = v.amountTwd === undefined ? "" : `新台幣 ${v.amountTwd.toLocaleString("zh-TW")} 元`;
  const sign = "\n\n——\nOingg\n本信僅說明訂閱與帳務狀態，不含任何投資建議。\n如有疑問請直接回覆本信。";

  switch (kind) {
    case "expiryReminder": {
      const days = v.daysUntilExpiry;
      // 30/7/1 三個節奏的差別只在語氣強度，不在資訊量：三封都要寫清楚日期與「不續訂會怎樣」。
      const lead =
        days !== undefined && days <= 1
          ? `您的 ${tier} 明天（${end}）到期。`
          : days !== undefined && days <= 7
            ? `您的 ${tier} 將於 ${end} 到期，還有 ${days} 天。`
            : `提醒您，${tier} 將於 ${end} 到期。`;
      return {
        subject: `Oingg 訂閱將於 ${end} 到期`,
        text: `${name}，\n\n${lead}\n\n到期後帳號會回到免費方案，自選股與查詢範圍會縮減，但**個股頁的分析內容不會減少**，您過去的持股與交易紀錄也都保留。\n\n要續訂請到網站的「訂閱」頁面操作。${sign}`,
      };
    }
    case "preChargeNotice":
      return {
        subject: `Oingg 訂閱將於 ${end} 自動續扣`,
        text: `${name}，\n\n您的 ${tier} 將於 ${end} 自動續扣${amount ? `，金額 ${amount}` : ""}。\n\n這封信是為了讓您事先知道，不需要任何動作。若要取消自動續約，請在該日之前到網站的「訂閱」頁面操作。${sign}`,
      };
    case "paymentReceipt":
      return {
        subject: "Oingg 收款成功",
        text: `${name}，\n\n已收到您的付款${amount ? `${amount}` : ""}，${tier} 的服務期間到 ${end}。\n\n發票將另行寄出。${sign}`,
      };
    case "refundConfirmed":
      return {
        subject: "Oingg 退費已完成",
        text: `${name}，\n\n您的退費${amount ? `${amount}` : ""}已經完成，實際入帳時間依發卡銀行或金流商作業而定。\n\n訂閱已終止，帳號回到免費方案；您的持股與交易紀錄都保留。${sign}`,
      };
    case "priceChangeNotice":
      return {
        subject: "Oingg 方案價格調整通知",
        text: `${name}，\n\n${tier} 的價格將調整${amount ? `為 ${amount}` : ""}。\n\n您目前的價格保留到 ${end}，在那之前不受影響。若不希望以新價格續訂，請在該日之前取消自動續約。${sign}`,
      };
  }
}

/**
 * 冪等以程序內的 Map 實作，**這是刻意的權宜，不是完成品**。
 *
 * ponytail: 程序內去重，換成 DB 的 SubscriptionReminder（append-only，見規格「未實作，且刻意不先建」）
 * 之後刪掉。現在不建那張表的理由跟規格一致——排程器與部署都還不存在，先建表是替一個不存在的呼叫端建表；
 * 而完全不做去重會讓手動觸發的冒煙測試在重跑時重複寄信。**多實例部署或重啟之後這個 Map 就失效**，
 * 所以在真的有排程器自動重試之前，不要靠它擋真實使用者會看到的重複。
 */
const sentKeys = new Map<string, string>();

export function createResendEmailClient(): EmailGatewayPort {
  return {
    async send({ to, kind, variables, idempotencyKey }: SendEmailInput): Promise<SendEmailResult> {
      const already = sentKeys.get(idempotencyKey);
      if (already) {
        logger.info({ kind, idempotencyKey }, "Email skipped: this idempotency key was already sent");
        return { providerMessageId: already, deduplicated: true };
      }

      const { subject, text } = renderTemplate(kind, variables);
      const from = process.env.EMAIL_FROM ?? DEFAULT_FROM;
      let response: Response;
      try {
        response = await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${requireEnv("RESEND_API_KEY")}`,
            "Content-Type": "application/json",
            // Resend 自己的冪等標頭，作用範圍 24 小時。跟上面的 Map 是兩層：這一層跨程序重啟仍然有效，
            // 但只涵蓋一天，所以兩層都留著，將來由 DB 那層取代 Map、這一層繼續當最後一道。
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({ from, to: [to], subject, text }),
          signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
        });
      } catch (error) {
        logger.error({ err: error, kind }, "Could not reach the email provider");
        throw new AppError("Could not reach the email provider", 502);
      }

      if (!response.ok) {
        // 收件地址不印進 log：帳務信的收件人就是使用者本人的 email，屬於個資，而這條 log 會進到
        // 集中式記錄裡。要查個案請用 idempotencyKey 反查，它的組成是 uid 而不是 email。
        const detail = await response.text().catch(() => "");
        logger.error({ status: response.status, kind, idempotencyKey, detail: detail.slice(0, 300) }, "Email provider returned a non-2xx status");
        throw new AppError(`Email provider returned ${response.status}`, 502);
      }

      const body = (await response.json().catch(() => ({}))) as { id?: unknown };
      if (typeof body.id !== "string") {
        throw new AppError("Email provider response is missing id", 502);
      }
      sentKeys.set(idempotencyKey, body.id);
      logger.info({ kind, providerMessageId: body.id, from, isProduction: env.isProduction }, "Email sent");
      return { providerMessageId: body.id, deduplicated: false };
    },
  };
}
