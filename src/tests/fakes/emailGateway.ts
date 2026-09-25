import { vi } from "vitest";
import type { EmailGatewayPort, SendEmailInput } from "@/application/ports/emailGateway.js";

/**
 * EmailGatewayPort 的具型別 fake，順便記下每一封被要求寄出的信。
 *
 * 記錄 `sent` 而不是只驗 call count，是因為這個 port 的測試重點不是「有沒有被呼叫」，而是**寄出去的是
 * 哪一種信**——那條界線（帳務可以、分析意見不行）是法律問題，值得在測試裡看得見。
 *
 * 照慣例用 port 的型別標註：EmailKind 增刪會在編譯期打斷這個檔案，而不是讓測試對著一個過期的形狀綠燈。
 */
export function fakeEmailGateway(overrides: Partial<EmailGatewayPort> = {}): EmailGatewayPort & { sent: SendEmailInput[] } {
  const sent: SendEmailInput[] = [];
  return {
    sent,
    send: vi.fn(async (input: SendEmailInput) => {
      sent.push(input);
      return { providerMessageId: `fake-${sent.length}`, deduplicated: false };
    }),
    ...overrides,
  };
}
