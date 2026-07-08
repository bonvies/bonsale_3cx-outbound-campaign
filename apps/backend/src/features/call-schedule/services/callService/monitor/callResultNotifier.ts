
// Handler 在 app.ts setupCallSchedule() 中透過 registerCallResultHandler() 註冊。
// 新增通知邏輯：實作 ICallResultHandler，在 app.ts 同處 register 即可，但要先想清楚
// 這個 handler 是「協定/設備層級」還是「客戶層級」：
//   - 協定層級（例如依 FIAS 規格回報 WA，見 fiasWakeupResultHandler.ts）：
//     只要有啟用該協定/設備就該註冊，不分客戶，改一次全部生效
//   - 客戶層級（例如某飯店要求結果額外 POST 到他們自己的系統）：
//     才需要每家客戶各寫一個 handler
// 不要把協定層級的邏輯誤放進「每家客戶各一份」的框架裡，之後會變成到處複製貼上。

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
 */
const _handlers: ICallResultHandler[] = [];

/**
 * 註冊一個通話結果 handler，在 app 啟動時呼叫。
 * 協定/設備層級的 handler 依能力旗標（如 ENABLE_FIAS）註冊；
 * 客戶層級的 handler 才需要每家客戶各自 register 一次。
 *
 * @example
 * registerCallResultHandler(new FiasWakeupResultHandler())  // 協定層級
 * registerCallResultHandler(new LakeshoreHotelHandler())    // 客戶層級（假設範例）
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
