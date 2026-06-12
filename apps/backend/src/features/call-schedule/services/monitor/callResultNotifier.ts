
// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

/** 通話最終結果狀態（只有這三種才會觸發通知） */
export type CallFinalStatus = 'ANSWERED' | 'NO_ANSWER' | 'ERROR';

/**
 * 通知 payload，傳給所有已註冊的 handler。
 * 未來若需要加欄位（如 roomNum、clientId），在這裡擴充即可。
 */
export type CallResultPayload = {
  scheduleId: string;
  extension: string;      // 被叫分機號碼
  finalStatus: CallFinalStatus;
  retryCount?: string;    // 重試進度，e.g. "2/3"（NO_ANSWER / ERROR 時才有值）
  callRecord?: string;    // 通話記錄時間戳（ANSWERED 時才有值）
};

/**
 * 所有客戶通知 handler 需實作此介面。
 *
 * 範例：
 * ```ts
 * class LakeshoreHotelHandler implements ICallResultHandler {
 *   async handle(payload: CallResultPayload) {
 *     await fetch('https://hotel-api/callback', { method: 'POST', body: JSON.stringify(payload) })
 *   }
 * }
 * ```
 *
 * // TODO: 未來可在此介面加入 `clientId` 或 `priority` 等屬性，
 * //       方便 notifyCallResult 做條件分流（e.g. 只通知特定客戶的 handler）
 */
export interface ICallResultHandler {
  handle(payload: CallResultPayload): void | Promise<void>;
}

// ─────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────

/**
 * 已註冊的 handler 列表。
 * 每次呼叫 notifyCallResult 時會依序執行所有 handler（互不影響）。
 *
 * // TODO: 若需要「移除特定 handler」的功能，改用 Map<string, ICallResultHandler>
 * //       並讓 registerCallResultHandler 回傳一個 unregister function
 */
const _handlers: ICallResultHandler[] = [];

/**
 * 註冊一個通話結果 handler。
 * 通常在 app 啟動時呼叫，每家客戶各自 register 一次。
 *
 * @example
 * registerCallResultHandler(new LakeshoreHotelHandler())
 * registerCallResultHandler(new InternalLogHandler())
 */
export function registerCallResultHandler(handler: ICallResultHandler): void {
  _handlers.push(handler);
}

// ─────────────────────────────────────────────
// Dispatch（供 callMonitorCore 呼叫）
// ─────────────────────────────────────────────

/**
 * 通話達到最終狀態時，由 callMonitorCore 呼叫此函式。
 * 會依序執行所有已註冊的 handler，單一 handler 失敗不影響其他 handler。
 *
 * // TODO: 目前為同步逐一執行；若 handler 數量多且各自有網路請求，
 * //       可改為 Promise.allSettled 並行執行以減少總等待時間
 *
 * // TODO: 若需要失敗重試（e.g. POST webhook 失敗要 retry），
 * //       在各自的 handler 內部實作，或抽一個 withRetry wrapper
 */
export function notifyCallResult(payload: CallResultPayload): void {
  for (const handler of _handlers) {
    try {
      void handler.handle(payload);
    } catch (err) {
      console.error('[CallResultNotifier] handler error:', err);
    }
  }
}
