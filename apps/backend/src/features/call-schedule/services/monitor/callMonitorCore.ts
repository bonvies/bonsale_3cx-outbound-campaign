import schedule from 'node-schedule';
import { getDatabase } from '../database';
import { phoneApiService } from '../api/phoneApiService';
import { logWithTimestamp, errorWithTimestamp } from '@shared-local/util/timestamp';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type PendingCall = {
  scheduleId: string;
  extension: string;
  from: string;
  retryCount: number;
  maxRetries: number;
  retryIntervalMs: number;
  answered: boolean;
};

export type RegisterCallOptions = {
  scheduleId: string;
  extension: string;   // to（被叫分機）
  from: string;        // from（主叫分機）
  retryCount?: number;
  maxRetries: number;
  retryIntervalMs: number;
};

export type FinalResultStatus = 'answered' | 'not_answered' | 'error';
export type FinalResultCallback = (status: FinalResultStatus) => void;

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────

// key = extension（被叫分機號碼）
const pendingCalls = new Map<string, PendingCall>();

// key = scheduleId，供外部（如 FIAS）登記通話結果回調
const finalResultCallbacks = new Map<string, FinalResultCallback>();

// ─────────────────────────────────────────────
// Final result callback helpers
// ─────────────────────────────────────────────

/** 登記通話最終結果回調（e.g. FIAS 用來送 WA） */
export function registerFinalResultCallback(scheduleId: string, cb: FinalResultCallback): void {
  finalResultCallbacks.set(scheduleId, cb);
}

/** 觸發並移除 callback；也可由外部直接呼叫（e.g. 撥打前就失敗的情況） */
export function notifyFinalResult(scheduleId: string, status: FinalResultStatus): void {
  const cb = finalResultCallbacks.get(scheduleId);
  if (!cb) return;
  finalResultCallbacks.delete(scheduleId);
  cb(status);
}

// ─────────────────────────────────────────────
// DB helper
// ─────────────────────────────────────────────

function updateStatus(scheduleId: string, status: string, callRecord?: string): void {
  try {
    const db = getDatabase();
    if (callRecord !== undefined) {
      db.prepare(
        `UPDATE call_schedules SET callStatus = ?, callRecord = ? WHERE id = ?`
      ).run(status, callRecord, scheduleId);
    } else {
      db.prepare(
        `UPDATE call_schedules SET callStatus = ? WHERE id = ?`
      ).run(status, scheduleId);
    }
    logWithTimestamp(`[CallMonitor] ${scheduleId} → status: ${status}`);
  } catch (err) {
    errorWithTimestamp('[CallMonitor] DB update failed:', err);
  }
}

// ─────────────────────────────────────────────
// 事件處理（供各設備 service 呼叫）
// ─────────────────────────────────────────────

export function handleRing(ext: string): void {
  const call = pendingCalls.get(ext);
  if (!call) return;
  logWithTimestamp(`[CallMonitor] 🔔 RING  ext=${ext} scheduleId=${call.scheduleId}`);
  updateStatus(call.scheduleId, '響鈴中', new Date().toISOString());
}

export function handleAnswer(ext: string): void {
  const call = pendingCalls.get(ext);
  if (!call) return;
  logWithTimestamp(`[CallMonitor] 📞 ANSWER ext=${ext} scheduleId=${call.scheduleId}`);
  call.answered = true;
  updateStatus(call.scheduleId, '已接聽', new Date().toISOString());
  pendingCalls.delete(ext);
  notifyFinalResult(call.scheduleId, 'answered');
}

export async function handleBye(ext: string): Promise<void> {
  const call = pendingCalls.get(ext);
  if (!call) return;

  if (call.answered) {
    logWithTimestamp(`[CallMonitor] 🔹 BYE ext=${ext} scheduleId=${call.scheduleId}（已接聽後掛斷）`);
    pendingCalls.delete(ext);
    return;
  }

  logWithTimestamp(
    `[CallMonitor] ☎️ BYE (未接聽) ext=${ext} scheduleId=${call.scheduleId} retryCount=${call.retryCount}/${call.maxRetries}`
  );

  const nextRetryCount = call.retryCount + 1;

  if (nextRetryCount > call.maxRetries) {
    logWithTimestamp(`[CallMonitor] 已達最大重試次數 (${call.maxRetries})，標記為未接聽`);
    updateStatus(call.scheduleId, '未接聽', new Date().toISOString());
    pendingCalls.delete(ext);
    notifyFinalResult(call.scheduleId, 'not_answered');
    return;
  }

  const retryAt = new Date(Date.now() + call.retryIntervalMs);
  logWithTimestamp(
    `[CallMonitor] 安排第 ${nextRetryCount}/${call.maxRetries} 次重試，時間: ${retryAt.toISOString()}`
  );
  updateStatus(call.scheduleId, `等待重試 (${nextRetryCount}/${call.maxRetries})`, new Date().toISOString());
  pendingCalls.delete(ext);

  schedule.scheduleJob(
    `retry_${call.scheduleId}_${nextRetryCount}`,
    retryAt,
    async () => {
      logWithTimestamp(
        `🔄 [CallMonitor] 執行第 ${nextRetryCount}/${call.maxRetries} 次重試 scheduleId=${call.scheduleId} ext=${ext}`
      );
      try {
        const result = await phoneApiService.makeCall(call.from, ext);
        if (!result.success) {
          errorWithTimestamp(`[CallMonitor] 重試撥打失敗:`, result.error);
          updateStatus(call.scheduleId, '錯誤', new Date().toISOString());
          notifyFinalResult(call.scheduleId, 'error');
          return;
        }
        updateStatus(call.scheduleId, '撥打中', new Date().toISOString());
        registerCall({
          scheduleId: call.scheduleId,
          extension: ext,
          from: call.from,
          retryCount: nextRetryCount,
          maxRetries: call.maxRetries,
          retryIntervalMs: call.retryIntervalMs,
        });
      } catch (err) {
        errorWithTimestamp(`[CallMonitor] 重試異常:`, err);
        updateStatus(call.scheduleId, '錯誤', new Date().toISOString());
        notifyFinalResult(call.scheduleId, 'error');
      }
    }
  );
}

// ─────────────────────────────────────────────
// 公開 API
// ─────────────────────────────────────────────

export function registerCall(opts: RegisterCallOptions): void {
  const { scheduleId, extension, from, retryCount = 0, maxRetries, retryIntervalMs } = opts;
  pendingCalls.set(extension, {
    scheduleId, extension, from, retryCount, maxRetries, retryIntervalMs, answered: false,
  });
  logWithTimestamp(
    `✍️ [CallMonitor] 已登記監控 scheduleId=${scheduleId} ext=${extension} from=${from} retry=${retryCount}/${maxRetries} retryIntervalMs=${retryIntervalMs}`
  );
}

export function cancelScheduleJobs(
  scheduleId: string,
  scheduledJobs: Record<string, { cancel: () => void }>,
): void {
  const mainJob = scheduledJobs[scheduleId];
  if (mainJob) {
    mainJob.cancel();
    logWithTimestamp(`[CallMonitor] Cancelled job for ID: ${scheduleId}`);
  }
  Object.keys(scheduledJobs).forEach((jobName) => {
    if (jobName.startsWith(`retry_${scheduleId}_`)) {
      scheduledJobs[jobName].cancel();
      logWithTimestamp(`[CallMonitor] Cancelled retry job: ${jobName}`);
    }
  });
}

export function getPendingCalls(): Map<string, PendingCall> {
  return pendingCalls;
}
