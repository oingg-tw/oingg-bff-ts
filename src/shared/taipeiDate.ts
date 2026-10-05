/** 台灣時間的今天，"YYYY-MM-DD"。用 UTC 的話，台灣早上 8 點以前會被當成前一天。 */
export function todayInTaipei(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}
