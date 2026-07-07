import express, { Router } from 'express';
import { ICallMonitorService } from '../../callMonitorService';
import { registerCall, cancelScheduleJobs, handleAnswer, handleBye } from '../callMonitorCore';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

// ⚠️ 欄位名稱尚待 app.py fias_posting 格式確認，目前與 Yeastar CDR 欄位對齊假設
type FreeSwitchCdrPayload = {
  uuid: string;
  call_from: string;   // 主叫分機
  call_to: string;     // 被叫分機（pendingCalls 的 key）
  status: 'ANSWERED' | 'NO ANSWER' | string;
  duration?: number;
  billsec?: number;
};

// ─────────────────────────────────────────────
// CDR 事件處理
// ─────────────────────────────────────────────

function handleCdrEvent(payload: FreeSwitchCdrPayload): void {
  const { call_from, call_to, status } = payload;
  console.log(`[FreeSwitchMonitor] 📋 CDR call_from=${call_from} call_to=${call_to} status=${status}`);

  if (status === 'ANSWERED') {
    handleAnswer(call_to);
  } else if (status === 'NO ANSWER') {
    handleBye(call_to).catch(err =>
      console.error('[FreeSwitchMonitor] handleBye error:', err)
    );
  } else {
    console.warn(`[FreeSwitchMonitor] ⚠️ 未知的通話狀態：${status}`);
  }
}

// ─────────────────────────────────────────────
// CDR Webhook Router（內部）
// ─────────────────────────────────────────────

const cdrRouter: Router = express.Router();

cdrRouter.post('/', (req, res) => {
  // 立即回應 200，避免 app.py 等待
  res.writeHead(200, { Connection: 'close', 'Content-Type': 'text/plain' });
  res.end();

  const payload = req.body as FreeSwitchCdrPayload;
  if (!payload?.call_to) {
    console.warn('[FreeSwitchMonitor] ⚠️ 收到空白或格式錯誤的 CDR payload');
    return;
  }

  handleCdrEvent(payload);
});

// ─────────────────────────────────────────────
// ICallMonitorService 實作
// ─────────────────────────────────────────────

function connect(router: Router): void {
  // 掛載於傳入的 placeholder router（已在 404 handler 之前預先註冊於 Express app）
  // 最終路徑：POST /api/call-schedule/freeswitch-cdr
  router.use('/freeswitch-cdr', cdrRouter);
  console.log('[FreeSwitchMonitor] 🚀 FreeSWITCH CDR Webhook 已就緒（POST /api/call-schedule/freeswitch-cdr）');
}

export const freeSwitchCallMonitor: ICallMonitorService = {
  registerCall,
  cancelScheduleJobs,

  start(router?: Router) {
    console.log('[FreeSwitchMonitor] 🚀 啟動 FreeSWITCH CDR 事件監聽');
    if (!router) throw new Error('[FreeSwitchMonitor] FreeSwitch 模式需要傳入 callScheduleRouter');
    connect(router);
  },
};
