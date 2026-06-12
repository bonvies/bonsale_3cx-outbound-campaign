import WebSocket from 'ws';
import { ICallMonitorService } from '../../callMonitorService';
import { registerCall, cancelScheduleJobs, handleAnswer, handleBye } from '../callMonitorCore';
import { getYeastarAccessToken, getYeastarApiHost } from '../../api/device/yeastarApi';

const HEARTBEAT_INTERVAL_MS = 25 * 1000;
const CDR_TYPE = 30012; // 通話結束 CDR 事件

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type YeastarCdrPayload = {
  call_id: string;
  call_from: string;
  call_to: string;
  status: 'ANSWERED' | 'NO ANSWER' | string;
  talk_duration: number;
};

type YeastarWsMessage = {
  type: number;
  sn: string;
  msg: string; // JSON 字串，需再 parse
};

// ─────────────────────────────────────────────
// WebSocket 連線管理
// ─────────────────────────────────────────────

function buildWsUrl(): string {
  const host = getYeastarApiHost().replace(/^https?/, 'wss');
  const token = getYeastarAccessToken();
  return `${host}/openapi/v1.0/subscribe?access_token=${token}`;
}

function connect(): void {
  const ws = new WebSocket(buildWsUrl(), {
    headers: { 'User-Agent': 'OpenAPI' },
    rejectUnauthorized: false,
  });

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  ws.on('open', () => {
    console.log('[YeastarMonitor] 🔌 WebSocket 已連線');
    ws.send(JSON.stringify({ topic_list: [CDR_TYPE] }));
    console.log(`[YeastarMonitor] 已訂閱 CDR 事件 (type ${CDR_TYPE})`);

    heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send('heartbeat');
      }
    }, HEARTBEAT_INTERVAL_MS);
  });

  ws.on('message', (data) => {
    const raw = data.toString();
    if (raw === 'heartbeat response') return;
    try {
      const wsMsg = JSON.parse(raw) as YeastarWsMessage;
      handleCdrEvent(wsMsg);
    } catch (err) {
      console.error('[YeastarMonitor] 無法解析訊息:', err);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[YeastarMonitor] ❌ 連線關閉 code=${code} reason=${reason.toString()}，5 秒後重連`);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    setTimeout(connect, 5000);
  });

  ws.on('error', (err) => {
    console.error('[YeastarMonitor] WebSocket 錯誤:', err);
  });
}

// ─────────────────────────────────────────────
// CDR 事件處理
// ─────────────────────────────────────────────

function handleCdrEvent(wsMsg: YeastarWsMessage): void {
  if (wsMsg.type !== CDR_TYPE) return;

  let payload: YeastarCdrPayload;
  try {
    payload = JSON.parse(wsMsg.msg);
  } catch {
    console.error('[YeastarMonitor] msg 無法解析:', wsMsg.msg);
    return;
  }

  const { call_from, call_to, status } = payload;
  console.log(`[YeastarMonitor] CDR call_from=${call_from} call_to=${call_to} status=${status}`);

  if (status === 'ANSWERED') {
    handleAnswer(call_to);
  } else if (status === 'NO ANSWER') {
    // NO ANSWER 或其他非接聽狀態 → 觸發重試邏輯
    handleBye(call_to).catch(err =>
      console.error('[YeastarMonitor] handleBye error:', err)
    );
  } else {
    console.warn('⚠️ 未知的撥號狀態回傳')
  }
}

// ─────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────

export const yeastarCallMonitor: ICallMonitorService = {
  registerCall,
  cancelScheduleJobs,

  start() {
    console.log('[YeastarMonitor] 🚀 啟動 Yeastar CDR 事件監聽');
    connect();
  },
};
