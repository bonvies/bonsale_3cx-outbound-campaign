import http from 'http';
import schedule from 'node-schedule';
import { getDatabase } from './database';
import { mackeCall } from './api/newRockApi';
import { logWithTimestamp, errorWithTimestamp } from '@shared-local/util/timestamp';

/**
 * NewRock OM API 撥號狀態監控服務
 *
 * 監聽 OM API 的 HTTP Push 事件（RING / ANSWER / BYE），
 * 依 retryInterval 與 maxRetries 自動重試未接聽的排程通話。
 */

const OM_MONITOR_PORT = process.env.OM_MONITOR_PORT
  ? parseInt(process.env.OM_MONITOR_PORT)
  : 4022;

type PendingCall = {
  scheduleId: string;
  extension: string;   // to（被叫分機）
  from: string;        // from（主叫分機）
  retryCount: number;
  maxRetries: number;
  retryIntervalMs: number; // ms
  answered: boolean;
};

// key = extension (被叫分機號碼)
const pendingCalls = new Map<string, PendingCall>();

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
// OM 事件處理
// ─────────────────────────────────────────────
function handleRing(ext: string): void {
  const call = pendingCalls.get(ext);
  if (!call) return;
  logWithTimestamp(`[CallMonitor] 🔔 RING  ext=${ext} scheduleId=${call.scheduleId}`);
  updateStatus(call.scheduleId, '響鈴中', new Date().toISOString());
}

function handleAnswer(ext: string): void {
  const call = pendingCalls.get(ext);
  if (!call) return;
  logWithTimestamp(`[CallMonitor] 📞 ANSWER ext=${ext} scheduleId=${call.scheduleId}`);
  call.answered = true;
  updateStatus(call.scheduleId, '已接聽', new Date().toISOString());
  pendingCalls.delete(ext);
}

async function handleBye(ext: string): Promise<void> {
  const call = pendingCalls.get(ext);
  if (!call) return;

  if (call.answered) {
    // 已接聽後掛斷，狀態已在 handleAnswer 設定
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
    return;
  }

  // 安排重試
  const retryAt = new Date(Date.now() + call.retryIntervalMs);
  logWithTimestamp(
    `[CallMonitor] 安排第 ${nextRetryCount}/${call.maxRetries} 次重試，時間: ${retryAt.toISOString()}`
  );
  updateStatus(call.scheduleId, `等待重試 (${nextRetryCount}/${call.maxRetries})`, new Date().toISOString());

  // 先從 map 移除，重試時再重新 register
  pendingCalls.delete(ext);

  schedule.scheduleJob(
    `retry_${call.scheduleId}_${nextRetryCount}`,
    retryAt,
    async () => {
      logWithTimestamp(
        `🔄 [CallMonitor] 執行第 ${nextRetryCount}/${call.maxRetries} 次重試 scheduleId=${call.scheduleId} ext=${ext}`
      );
      try {
        const result = await mackeCall(call.from, ext);
        if (!result.success) {
          errorWithTimestamp(`[CallMonitor] 重試撥打失敗:`, result.error);
          updateStatus(call.scheduleId, '錯誤', new Date().toISOString());
          return;
        }
        updateStatus(call.scheduleId, '撥打中', new Date().toISOString());
        // 重新監控這通重試的通話
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
      }
    }
  );
}

// ─────────────────────────────────────────────
// 公開 API
// ─────────────────────────────────────────────
export type RegisterCallOptions = {
  scheduleId: string;
  extension: string;   // to（被叫分機）
  from: string;        // from（主叫分機）
  retryCount?: number;
  maxRetries: number;
  retryIntervalMs: number;
};

export function registerCall(opts: RegisterCallOptions): void {
  const { scheduleId, extension, from, retryCount = 0, maxRetries, retryIntervalMs } = opts;
  pendingCalls.set(extension, {
    scheduleId,
    extension,
    from,
    retryCount,
    maxRetries,
    retryIntervalMs,
    answered: false,
  });
  logWithTimestamp(
    `✍️ [CallMonitor] 已登記監控 scheduleId=${scheduleId} ext=${extension} from=${from} retry=${retryCount}/${maxRetries} maxRetries=${maxRetries} retryIntervalMs=${retryIntervalMs}`
  );
}

/**
 * 取消指定排程的主 job 與所有 retry job
 * 適用於 PUT（重新排程）和 DELETE（刪除排程）
 */
export function cancelScheduleJobs(scheduleId: string, scheduledJobs: Record<string, { cancel: () => void }>): void {
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

// ─────────────────────────────────────────────
// HTTP 監聽伺服器（接收 OM API Push）
// ─────────────────────────────────────────────
export function startCallMonitorServer(): void {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      // 立即回應 200，避免 OM 裝置等待
      res.writeHead(200, { Connection: 'close', 'Content-Type': 'text/plain' });
      res.end();
      logWithTimestamp(body);
      if (!body) return; 

      // 從 body 抓出所有 <ext id="xxxx">，找出有在 pendingCalls 追蹤的那個
      const allExts = [...body.matchAll(/id="(\d+)"/g)].map(m => m[1]);
      const trackedExt = allExts.find(e => pendingCalls.has(e));
      const firstExt = allExts[0]; // 用於 log

      if (body.includes('attribute="RING"')) {
        if (trackedExt) handleRing(trackedExt);
      } else if (body.includes('attribute="ANSWER"')) {
        // 我方接聽
        logWithTimestamp(`[CallMonitor] 📞 ANSWER ext=${firstExt ?? '?'}`);
      } else if (body.includes('attribute="ANSWERED"')) {
        // 對方接聽
        if (trackedExt) handleAnswer(trackedExt);
      } else if (body.includes('attribute="FAILED"')) {
        // 系統判斷失敗 → 觸發重試
        if (trackedExt) handleBye(trackedExt).catch((err) =>
          errorWithTimestamp('[CallMonitor] handleBye (FAILED) error:', err)
        );
      } else if (body.includes('attribute="IDLE"')) {
        // 對方未接聽，分機空閒 → 觸發重試
        if (trackedExt) handleBye(trackedExt).catch((err) =>
          errorWithTimestamp('[CallMonitor] handleBye (IDLE) error:', err)
        );
      } else if (body.includes('attribute="BYE"')) {
        // 我方掛斷，通話正常結束 → 不觸發重試，只清除監控
        logWithTimestamp(`[CallMonitor] 📴 BYE ext=${firstExt ?? '?'}（我方掛斷）`);
        if (trackedExt) pendingCalls.delete(trackedExt);
      } else if (body.includes('attribute="BUSY"')) {
        logWithTimestamp(`[CallMonitor] 📴 BUSY ext=${firstExt ?? '?'}`);
      } else if (body.includes('<Cdr')) {
        const duration = body.match(/<Duration>(\d+)<\/Duration>/)?.[1];
        logWithTimestamp(`[CallMonitor] 📊 通話記錄 ext=${firstExt ?? '?'} 通話時長=${duration ?? '?'} 秒`);
      }
    });
  });

  server.listen(OM_MONITOR_PORT, () => {
    logWithTimestamp(
      `[CallMonitor] 🚀 OM 事件監聽伺服器啟動於 Port ${OM_MONITOR_PORT}`
    );
  });
}
