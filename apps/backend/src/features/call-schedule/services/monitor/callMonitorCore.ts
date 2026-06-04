import schedule from 'node-schedule';
import { getDatabase } from '../database';
import { phoneApiService } from '../api/phoneApiService';
import { logWithTimestamp, errorWithTimestamp } from '@shared-local/util/timestamp';
import { notifyCallResult } from './callResultNotifier';

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

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────

// key = extension（被叫分機號碼）
const pendingCalls = new Map<string, PendingCall>();

// ─────────────────────────────────────────────
// DB helper
// ─────────────────────────────────────────────

function updateStatus(scheduleId: string, status: string, callRecord?: string, retryCount?: string | null): void {
  try {
    const db = getDatabase();
    const setClauses = ['callStatus = ?'];
    const values: (string | null)[] = [status];

    if (callRecord !== undefined) {
      setClauses.push('callRecord = ?');
      values.push(callRecord);
    }
    if (retryCount !== undefined) {
      setClauses.push('retryCount = ?');
      values.push(retryCount);
    }
    values.push(scheduleId);

    db.prepare(`UPDATE call_schedules SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
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
  updateStatus(call.scheduleId, 'RINGING');
}

export function handleAnswer(ext: string): void {
  const call = pendingCalls.get(ext);
  if (!call) return;
  logWithTimestamp(`[CallMonitor] 📞 ANSWER ext=${ext} scheduleId=${call.scheduleId}`);
  call.answered = true;
  updateStatus(call.scheduleId, 'ANSWERED', new Date().toISOString());
  pendingCalls.delete(ext);
  notifyCallResult({ scheduleId: call.scheduleId, extension: ext, finalStatus: 'ANSWERED', callRecord: new Date().toISOString() });
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
    updateStatus(call.scheduleId, 'NO_ANSWER', new Date().toISOString());
    pendingCalls.delete(ext);
    notifyCallResult({ scheduleId: call.scheduleId, extension: ext, finalStatus: 'NO_ANSWER', retryCount: `${call.retryCount}/${call.maxRetries}` });
    return;
  }

  const retryAt = new Date(Date.now() + call.retryIntervalMs);
  logWithTimestamp(
    `[CallMonitor] 安排第 ${nextRetryCount}/${call.maxRetries} 次重試，時間: ${retryAt.toISOString()}`
  );
  updateStatus(call.scheduleId, 'WAITING_RETRY', new Date().toISOString(), `${nextRetryCount}/${call.maxRetries}`);
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
          updateStatus(call.scheduleId, 'ERROR', new Date().toISOString());
          notifyCallResult({ scheduleId: call.scheduleId, extension: ext, finalStatus: 'ERROR', retryCount: `${nextRetryCount}/${call.maxRetries}` });
          return;
        }
        updateStatus(call.scheduleId, 'CALLING');
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
        updateStatus(call.scheduleId, 'ERROR', new Date().toISOString());
        notifyCallResult({ scheduleId: call.scheduleId, extension: ext, finalStatus: 'ERROR', retryCount: `${nextRetryCount}/${call.maxRetries}` });
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
