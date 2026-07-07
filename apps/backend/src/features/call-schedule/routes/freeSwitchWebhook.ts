import express, { Router, Request, Response } from 'express';
import { getFiasConn } from '../util/fiasConnectionStore';

const router: Router = express.Router();

// 見《FusionPBX / FreeSWITCH PMS-FIAS 整合說明書》12-14 章：
// 客房外撥通話結束後，FreeSWITCH XML CDR 觸發 app.py 解析並產生 FIAS posting JSON，
// fias_payload 是已經組好的完整 FIAS PS 記錄字串（例如 PS|RN3009|PTC|TA500|...）
type FiasPostingPayload = {
  should_post: boolean;
  fias_payload: string;
  room_number?: string;
  guest_name?: string;
  amount?: number;
  billsec?: number;
  category?: string;
};

// POST /api/call-schedule/freeswitch-webhook
// 不需要 token（見說明書 6 章：/webhook 是 FreeSWITCH XML CDR 使用，不加 token）
router.post('/', (req: Request, res: Response) => {
  // 立即回應，避免 app.py 等待
  res.json({ ok: true });

  const payload = req.body as FiasPostingPayload;
  console.log('[FreeSwitchWebhook] 收到 CDR:', JSON.stringify(payload, null, 2));

  // 接收規則見說明書 16 章：只有 should_post=true 且 fias_payload 不為空才轉送 Protel
  if (!payload?.should_post) {
    console.log('[FreeSwitchWebhook] should_post=false，不轉送');
    return;
  }
  if (!payload.fias_payload) {
    console.warn('[FreeSwitchWebhook] should_post=true 但 fias_payload 為空，不轉送');
    return;
  }

  const conn = getFiasConn();
  if (!conn) {
    console.warn(`[FreeSwitchWebhook] FIAS 未連線，無法轉送計費資料（房間=${payload.room_number}）`);
    return;
  }

  conn.send(payload.fias_payload);
  console.log(`[FreeSwitchWebhook] 已轉送計費資料給 Protel：房間=${payload.room_number} 金額=${payload.amount}`);
});

export default router;
