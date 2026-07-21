import express, { Router } from 'express';
import { ICallMonitorService } from '../../callMonitorService';
import { registerCall, cancelScheduleJobs, handleAnswer, handleBye } from '../callMonitorCore';
import { getFiasConn } from '@call-schedule/util/fiasConnectionStore';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

// 見《FusionPBX / FreeSWITCH PMS-FIAS 整合說明書》12-14 章：
// 客房外撥通話結束後，FreeSWITCH XML CDR 觸發 app.py 解析並產生 FIAS posting JSON，
// fias_payload 是已經組好的完整 FIAS PS 記錄字串（例如 PS|RN3009|PTC|TA500|...）
type FiasPostingPayload = {
  type: 'fias_posting';
  should_post: boolean;
  fias_payload: string;
  room_number?: string;
  guest_name?: string;
  amount?: number;
  billsec?: number;
  category?: string;
};

// 通話結果回呼（BonUC 文件 4.2/5：make_morning_call、make_call 帶 callback_url 後，
// 通話結束由 middleware POST 此 payload 到 callback_url）
type CallResultPayload = {
  profile: 'call_result';
  type: 'call_result';
  request_id: string;
  status: string;            // e.g. 'finished'
  result: 'answered' | string;
  purpose: 'morning_call' | 'make_call' | string;
  domain?: string;
  uuid?: string;
  room_number?: string;
  extension?: string;        // 被叫分機（pendingCalls 的 key）
  caller?: string;
  callee?: string;
  billsec?: number;
  duration?: number;
  hangup_cause?: string;     // e.g. 'NORMAL_CLEARING'
  start_stamp?: string;
  answer_stamp?: string;
  end_stamp?: string;
};

type FreeSwitchWebhookPayload = FiasPostingPayload | CallResultPayload;

// ─────────────────────────────────────────────
// 分流處理
// ─────────────────────────────────────────────

// 房客自己撥出的計費通話 → 轉送 FIAS posting 給 Protel
// 接收規則見說明書 16 章：只有 should_post=true 且 fias_payload 不為空才轉送
function handleFiasPosting(payload: FiasPostingPayload): void {
  if (!payload.should_post) {
    console.log('[FreeSwitchMonitor] should_post=false，不轉送');
    return;
  }
  if (!payload.fias_payload) {
    console.warn('[FreeSwitchMonitor] should_post=true 但 fias_payload 為空，不轉送');
    return;
  }

  const conn = getFiasConn();
  if (!conn) {
    console.warn(`[FreeSwitchMonitor] FIAS 未連線，無法轉送計費資料（房間=${payload.room_number}）`);
    return;
  }

  conn.send(payload.fias_payload);
  console.log(`[FreeSwitchMonitor] 已轉送計費資料給 Protel：房間=${payload.room_number} 金額=${payload.amount}`);
}

// 通話結果回呼 → 接聽完成；未接/失敗則進重試邏輯（共用 callMonitorCore）
function handleCallResult(payload: CallResultPayload): void {
  const { request_id, result, purpose, hangup_cause } = payload;
  // 被叫分機優先取 extension，缺漏時退回 room_number / callee（同值不同欄位名）
  const extension = payload.extension ?? payload.room_number ?? payload.callee;

  console.log(`[FreeSwitchMonitor] 📋 通話結果 request_id=${request_id} purpose=${purpose} extension=${extension} result=${result} hangup_cause=${hangup_cause}`);

  if (!extension) {
    console.warn('[FreeSwitchMonitor] ⚠️ callback payload 缺少 extension/room_number，忽略');
    return;
  }

  if (result === 'answered') {
    handleAnswer(extension, request_id);
  } else {
    // answered 以外（未接、忙線、失敗等）一律走重試邏輯；
    // 分機不在 pendingCalls 追蹤中時（例如 make_call 打的非叫醒電話）為 no-op
    handleBye(extension, request_id).catch(err =>
      console.error('[FreeSwitchMonitor] handleBye error:', err)
    );
  }
}

// ─────────────────────────────────────────────
// Webhook Router（統一接收口）
// ─────────────────────────────────────────────

// FreeSWITCH middleware（app.py）所有 CDR / 回呼的統一入口，依 payload.type 分流：
//   fias_posting → 房客外撥計費，轉送 Protel
//   call_result  → make_morning_call / make_call 帶 callback_url 的通話結果回呼，
//                  驅動接聽/重試邏輯（BonUC 文件 4.2/5）
// 不需要 token（見說明書 6 章：/webhook 是 FreeSWITCH XML CDR 使用，不加 token）
const webhookRouter: Router = express.Router();

webhookRouter.post('/', (req, res) => {
  // 立即回應 200，避免 app.py 等待
  res.json({ ok: true });

  const payload = req.body as FreeSwitchWebhookPayload;
  console.log('[FreeSwitchMonitor] 收到 CDR:', JSON.stringify(payload, null, 2));

  switch (payload?.type) {
    case 'fias_posting':
      handleFiasPosting(payload);
      break;

    case 'call_result':
      handleCallResult(payload);
      break;

    default:
      console.warn(`[FreeSwitchMonitor] 未知的 payload type：${(payload as { type?: string })?.type ?? '(未提供)'}，忽略`);
  }
});

// ─────────────────────────────────────────────
// ICallMonitorService 實作
// ─────────────────────────────────────────────

function connect(router: Router): void {
  // 掛載於傳入的 placeholder router（已在 404 handler 之前預先註冊於 Express app）。
  // 只有 TELEPHONE_EQUIPMENT=FreeSwitch 時 start() 才會被呼叫，故不需額外設備判斷。
  // 最終路徑：POST /api/call-schedule/freeswitch-webhook
  router.use('/freeswitch-webhook', webhookRouter);
  console.log('[FreeSwitchMonitor] 🚀 FreeSWITCH CDR Webhook 已就緒（POST /api/call-schedule/freeswitch-webhook）');
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
