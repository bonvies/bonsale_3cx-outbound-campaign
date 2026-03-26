// ─────────────────────────────────────────────
// 共用 PMS 介面型別
// 供 FIAS、Nortel PMS 等各協定實作共享
// ─────────────────────────────────────────────

/** 解析後的 PMS 訊息，各協定共用此結構 */
export interface PmsMessage {
  type: string;
  fields: Record<string, string>;
}

/** PMS 連線物件，封裝回應發送 */
export interface PmsConn {
  send(content: string): void;
}

/** PMS 訊息處理函式簽名 */
export type PmsHandler = (msg: PmsMessage, conn: PmsConn) => void | Promise<void>;
