import schedule from 'node-schedule';
import { getDatabase } from '../../database';
import { phoneApiService } from '../phoneApiService';
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

// key = extension（被叫分機號碼），value = 該分機目前在飛行中的通話佇列（FIFO）。
// 用陣列而非單一物件是因為同分機可能同時有多通電話在監控中（例如同房間短時間內
// 收到多筆 WR，或重試撞上下一筆排程）——RING/ANSWER/BYE 事件只帶分機號碼，無法
// 精確對應是哪一通，因此以「先登記的先處理」為前提，用佇列先進先出比對，避免用
// 單一 Map entry 導致後面登記的覆蓋前面的、讓前一通的事件被吃掉（見
// docs/FIAS_LAKESHORE_TEST_LOG.md 同分機重疊測試的紀錄）。
const pendingCalls = new Map<string, PendingCall[]>();

function peekCall(ext: string): PendingCall | undefined {
  return pendingCalls.get(ext)?.[0];
}

function dequeueCall(ext: string): PendingCall | undefined {
  const queue = pendingCalls.get(ext);
  if (!queue || queue.length === 0) return undefined;
  const call = queue.shift();
  if (queue.length === 0) pendingCalls.delete(ext);
  return call;
}

function enqueueCall(call: PendingCall): void {
  const queue = pendingCalls.get(call.extension) ?? [];
  queue.push(call);
  pendingCalls.set(call.extension, queue);
}

// ─────────────────────────────────────────────
// DB helper
// ─────────────────────────────────────────────

function updateStatus(scheduleId: string, status: string, callRecord?: string, retryCount?: number | null): void {
  try {
    const db = getDatabase();
    const setClauses = ['callStatus = ?'];
    const values: (string | number | null)[] = [status];

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
    console.log(`[CallMonitor] ${scheduleId} → status: ${status}`);
  } catch (err) {
    console.error('[CallMonitor] DB update failed:', err);
  }
}

// ─────────────────────────────────────────────
// 事件處理（供各設備 service 呼叫）
// ─────────────────────────────────────────────

export function handleRing(ext: string): void {
  const call = peekCall(ext);
  if (!call) return;
  console.log(`[CallMonitor] 🔔 RING  ext=${ext} scheduleId=${call.scheduleId}`);
  updateStatus(call.scheduleId, 'RINGING');
}

export function handleAnswer(ext: string): void {
  const call = dequeueCall(ext);
  if (!call) return;
  console.log(`[CallMonitor] 📞 ANSWER ext=${ext} scheduleId=${call.scheduleId}`);
  updateStatus(call.scheduleId, 'ANSWERED', new Date().toISOString());
  notifyCallResult({ scheduleId: call.scheduleId, extension: ext, finalStatus: 'ANSWERED', callRecord: new Date().toISOString() });
}

// 我方主動掛斷、通話正常結束的清理（不進重試邏輯），供設備 service 在偵測到
// 「我方掛斷」事件時呼叫（例如 NewRock 的 BYE attribute）。
export function clearPendingCall(ext: string): void {
  dequeueCall(ext);
}

export async function handleBye(ext: string): Promise<void> {
  const call = dequeueCall(ext);
  if (!call) return;

  console.log(
    `[CallMonitor] ☎️ BYE (未接聽) ext=${ext} scheduleId=${call.scheduleId} retryCount=${call.retryCount}/${call.maxRetries}`
  );

  const nextRetryCount = call.retryCount + 1;

  if (nextRetryCount > call.maxRetries) {
    console.log(`[CallMonitor] 已達最大重試次數 (${call.maxRetries})，標記為未接聽`);
    updateStatus(call.scheduleId, 'NO_ANSWER', new Date().toISOString());
    notifyCallResult({ scheduleId: call.scheduleId, extension: ext, finalStatus: 'NO_ANSWER', retryCount: `${call.retryCount}/${call.maxRetries}` });
    return;
  }

  const retryAt = new Date(Date.now() + call.retryIntervalMs);
  console.log(
    `[CallMonitor] 安排第 ${nextRetryCount}/${call.maxRetries} 次重試，時間: ${retryAt.toISOString()}`
  );
  updateStatus(call.scheduleId, 'WAITING_RETRY', new Date().toISOString(), nextRetryCount);

  schedule.scheduleJob(
    `retry_${call.scheduleId}_${nextRetryCount}`,
    retryAt,
    async () => {
      console.log(
        `🔄 [CallMonitor] 執行第 ${nextRetryCount}/${call.maxRetries} 次重試 scheduleId=${call.scheduleId} ext=${ext}`
      );
      try {
        const result = await phoneApiService.makeCall(call.from, ext);
        if (!result.success) {
          console.error(`[CallMonitor] 重試撥打失敗:`, result.error);
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
        console.error(`[CallMonitor] 重試異常:`, err);
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
  enqueueCall({ scheduleId, extension, from, retryCount, maxRetries, retryIntervalMs });
  console.log(
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
    console.log(`[CallMonitor] Cancelled job for ID: ${scheduleId}`);
  }
  Object.keys(scheduledJobs).forEach((jobName) => {
    if (jobName.startsWith(`retry_${scheduleId}_`)) {
      scheduledJobs[jobName].cancel();
      console.log(`[CallMonitor] Cancelled retry job: ${jobName}`);
    }
  });
}

export function getPendingCalls(): Map<string, PendingCall[]> {
  return pendingCalls;
}
