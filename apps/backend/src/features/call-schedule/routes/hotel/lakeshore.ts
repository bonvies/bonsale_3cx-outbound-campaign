import express, { Router, Request, Response } from 'express';
import { fromZonedTime } from 'date-fns-tz';
import { getFiasConn } from '../../util/fiasConnectionStore';
import { getSiteTimezone } from '../../util/timezone';
import { checkin, checkout, update, TollAllow } from '../../services/api/freeSwitchPmsApi';
import lakeshoreRoomNumbers from './lakeshoreRoomNumbers.json';

// 煙波飯店（Lakeshore）房號清單，飯店提供，用於驗證房務系統推送的 roomno 是否存在
// 《房務狀態串接開發規格書》4.3-4：房號不存在時應回 retcode 005
const LAKESHORE_ROOM_NUMBERS: ReadonlySet<string> = new Set(lakeshoreRoomNumbers);

const router: Router = express.Router();

// 房務狀態代碼（《房務狀態串接開發規格書》4.1-3）
const VALID_ROOM_STATUSES = ['0', '1', '2', '4', '5', '6'];
// statustime 早於「現在-10分」視為過期（規格書 4.3-5）
const STATUSTIME_MAX_AGE_MS = 10 * 60 * 1000;

// check-in 通話權限（見《FusionPBX / FreeSWITCH PMS-FIAS 整合說明書》4.1）：
// 由煙波在 request 裡指定房型/規則對應的等級，未帶值則用預設
const VALID_TOLL_ALLOWS: TollAllow[] = ['CS0', 'CS1', 'CS2', 'CS3'];
const DEFAULT_TOLL_ALLOW: TollAllow = 'CS2';

// 煙波 roomstatus 直接當 FIAS RS 送出，不做轉換：實測發現 Oracle 官方 Appendix B
// 的 RS 代碼（1=Dirty/Vacant...6=Inspected/Occupied）跟這台 Protel 實際設定不符
//（例如送 RS5 結果 Protel 顯示「清潔中」而非官方定義的「已檢查」），規格本身也
// 註明「Further values may be possible depending on the Hotels PMS setup」，
// 與其猜測對照表，不如直接照煙波原始代碼送出，由飯店那邊自行決定代碼意義。

const RETCODE_MSG: Record<string, string> = {
  '000': '成功',
  '001': '[protel錯誤代碼]+[protel 回傳的msg]', // TODO 若能識別protel執行失敗，歸類於此retcode
  '002': '狀態錯誤',
  '003': '非白名單IP',
  '004': '參數錯誤',
  '005': '房號錯誤',
  '006': '時間錯誤',
  '999': '未知錯誤',
};

// retcode 對應的 HTTP status code，非成功不應該回 200
const RETCODE_HTTP_STATUS: Record<string, number> = {
  '000': 200,
  '001': 502, // Protel/PMS 端失敗
  '002': 400,
  '003': 403,
  '004': 400,
  '005': 400,
  '006': 400,
  '999': 500,
};

function respond(res: Response, retcode: string, data?: unknown): void {
  res.status(RETCODE_HTTP_STATUS[retcode] ?? 500).json({ retcode, msg: RETCODE_MSG[retcode], data });
}

// 檢核白名單
function isWhitelisted(ip: string): boolean {
  const whitelist = (process.env.LAKESHORE_IP_WHITELIST ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (whitelist.length === 0) return true;
  return whitelist.includes(ip);
}

// 白名單檢核 + 拒絕時的回應，回傳 true 代表已回應、呼叫端應立即 return
function rejectIfNotWhitelisted(req: Request, res: Response): boolean {
  const clientIp = req.ip ?? req.socket.remoteAddress ?? '';
  if (isWhitelisted(clientIp)) return false;
  console.warn(`[Lakeshore] 拒絕非白名單 IP: ${clientIp}`);
  respond(res, '003', { message: `client IP ${clientIp} not in whitelist` });
  return true;
}

// statustime 格式為 "YYYY-MM-DD HH:mm:ss"，視為飯店當地時間（非 UTC）
function parseStatusTime(statustime: string, timezone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(statustime);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const local = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (isNaN(local.getTime())) return null;
  return fromZonedTime(local, timezone);
}

// POST /api/v1/lakeshore/room/status
// 煙波飯店房務系統推送房況異動 → 驗證後轉發給 Protel PMS（透過既有 FIAS TCP 連線）
// 規格書：《房務狀態串接開發規格書》v1.0 2026-04-27
router.post('/room/status', async (req: Request, res: Response) => {
  try {
    console.log('[Lakeshore] ===== Incoming Request =====');
    console.log('[Lakeshore] Body:', JSON.stringify(req.body, null, 2));

    // 檢核白名單，非白名單 IP 直接回應 403
    if (rejectIfNotWhitelisted(req, res)) return;

    const { roomno, statustime } = req.body;
    // 規格書欄位表寫 roomstatus，但 JSON 範例卻用 status，兩者皆接受
    const roomstatus = req.body.roomstatus ?? req.body.status;

    // 檢核必填欄位
    if (!roomno || roomstatus === undefined || roomstatus === null || roomstatus === '' || !statustime) {
      respond(res, '004', { message: 'roomno, roomstatus and statustime are required' });
      return;
    }

    // 檢核 roomstatus 是否為有效代碼（見《房務狀態串接開發規格書》4.1-3）
    if (!VALID_ROOM_STATUSES.includes(String(roomstatus))) {
      respond(res, '002', { message: `invalid roomstatus: ${roomstatus}` });
      return;
    }

    // 檢核房號是否存在（房號清單見 lakeshoreRoomNumbers.json，飯店提供）
    if (!LAKESHORE_ROOM_NUMBERS.has(String(roomno))) {
      respond(res, '005', { message: `unknown roomno: ${roomno}` });
      return;
    }

    // 檢核 statustime 是否為有效時間字串，且不早於「現在-10分」
    const timezone = await getSiteTimezone();
    const statusDate = parseStatusTime(statustime, timezone);
    if (!statusDate || statusDate.getTime() < Date.now() - STATUSTIME_MAX_AGE_MS) {
      respond(res, '006', { message: `invalid or stale statustime: ${statustime}` });
      return;
    }

    // 轉發給 Protel（FIAS TCP，RE/RS 記錄，fire-and-forget：暫不等待 PMS 回應結果，見 docs/FIAS_INTEGRATION.md）
    const conn = getFiasConn();
    if (conn) {
      const fiasRs = String(roomstatus);
      conn.send(`RE|RN${roomno}|RS${fiasRs}|`);
      console.log(`RE|RN${roomno}|RS${fiasRs}|`);
      console.log(`[Lakeshore] 房況已轉發給 Protel：房間=${roomno} 煙波狀態=${roomstatus} → FIAS RS=${fiasRs}`);
    } else {
      console.warn(`[Lakeshore] FIAS 未連線，房況無法轉發給 Protel（房間=${roomno} 狀態=${roomstatus}）`);
    }

    respond(res, '000', { roomno, roomstatus });
  } catch (error) {
    console.error('[Lakeshore] POST /room/status error:', error);
    respond(res, '999', { error });
  }
});

// POST /api/v1/lakeshore/checkin
// 客人入住 → 更新 FusionPBX 分機的通話權限與顯示名稱（透過 FIAS Middleware，見 docs/FIAS_INTEGRATION.md）
// 欄位命名暫比照 /room/status 的慣例自行設計，待煙波提供正式規格書後再調整
router.post('/checkin', async (req: Request, res: Response) => {
  try {
    console.log('[Lakeshore] ===== Incoming Checkin Request =====');
    console.log('[Lakeshore] Body:', JSON.stringify(req.body, null, 2));

    if (rejectIfNotWhitelisted(req, res)) return;

    const { room_number, guest_name, toll_allow } = req.body;
    if (!room_number || !guest_name) {
      respond(res, '004', { message: 'room_number and guest_name are required' });
      return;
    }

    // 通話權限由煙波依房型/規則自行指定，未帶值則用預設（CS2：市內＋國內＋行動，不含國際）
    let resolvedTollAllow: TollAllow = DEFAULT_TOLL_ALLOW;
    if (toll_allow !== undefined && toll_allow !== null && toll_allow !== '') {
      if (!VALID_TOLL_ALLOWS.includes(String(toll_allow) as TollAllow)) {
        respond(res, '004', { message: `invalid toll_allow: ${toll_allow}` });
        return;
      }
      resolvedTollAllow = String(toll_allow) as TollAllow;
    }

    const result = await checkin(String(room_number), String(guest_name), resolvedTollAllow);
    if (!result.success) {
      console.error(`[Lakeshore] checkin 失敗（房間=${room_number}）:`, result.error);
      respond(res, '999', { error: result.error });
      return;
    }

    console.log(`[Lakeshore] check-in 完成：房間=${room_number} 房客=${guest_name} 權限=${resolvedTollAllow}`);
    respond(res, '000', { data: result.data });
  } catch (error) {
    console.error('[Lakeshore] POST /checkin error:', error);
    respond(res, '999', { error });
  }
});

// POST /api/v1/lakeshore/checkout
// 客人退房 → 還原 FusionPBX 分機的通話權限與顯示名稱（透過 FIAS Middleware）
router.post('/checkout', async (req: Request, res: Response) => {
  try {
    console.log('[Lakeshore] ===== Incoming Checkout Request =====');
    console.log('[Lakeshore] Body:', JSON.stringify(req.body, null, 2));

    if (rejectIfNotWhitelisted(req, res)) return;

    const { room_number } = req.body;
    if (!room_number) {
      respond(res, '004');
      return;
    }

    const result = await checkout(String(room_number));
    if (!result.success) {
      console.error(`[Lakeshore] checkout 失敗（房間=${room_number}）:`, result.error);
      respond(res, '999');
      return;
    }

    console.log(`[Lakeshore] check-out 完成：房間=${room_number}`);
    respond(res, '000', { data: result.data });
  } catch (error) {
    console.error('[Lakeshore] POST /checkout error:', error);
    respond(res, '999');
  }
});

// POST /api/v1/lakeshore/update
// 直接指定欄位更新分機（不經過 checkin/checkout 的自動規則），見《整合說明書》5.3。
// toll_allow/effective_caller_id_name 為選填，未帶值時交給 FIAS Middleware 決定是否變更。
router.post('/update', async (req: Request, res: Response) => {
  try {
    console.log('[Lakeshore] ===== Incoming Update Request =====');
    console.log('[Lakeshore] Body:', JSON.stringify(req.body, null, 2));

    if (rejectIfNotWhitelisted(req, res)) return;

    const { extension, toll_allow, effective_caller_id_name, effective_caller_id_number } = req.body;
    if (!extension) {
      respond(res, '004', { message: 'extension is required' });
      return;
    }

    if (toll_allow !== undefined && toll_allow !== null && toll_allow !== '' && !VALID_TOLL_ALLOWS.includes(String(toll_allow) as TollAllow)) {
      respond(res, '004', { message: `invalid toll_allow: ${toll_allow}` });
      return;
    }

    const result = await update({
      extension: String(extension),
      tollAllow: toll_allow ? (String(toll_allow) as TollAllow) : undefined,
      effectiveCallerIdName: effective_caller_id_name ? String(effective_caller_id_name) : undefined,
      effectiveCallerIdNumber: effective_caller_id_number ? String(effective_caller_id_number) : undefined,
    });
    if (!result.success) {
      console.error(`[Lakeshore] update 失敗（分機=${extension}）:`, result.error);
      respond(res, '999', { error: result.error });
      return;
    }

    console.log(`[Lakeshore] update 完成：分機=${extension}`);
    respond(res, '000', { data: result.data });
  } catch (error) {
    console.error('[Lakeshore] POST /update error:', error);
    respond(res, '999', { error });
  }
});

// POST /api/v1/lakeshore/test-fias-result
// 測試用：手動透過現有 FIAS TCP 連線送一筆 CA（電話費）給 PMS，確認通道是否暢通
// Body: { roomNum: string, duration?: string, amount?: string, phoneNumber?: string }
router.post('/test-fias-result', (req: Request, res: Response) => {
  const {
    message,
  } = req.body as { message?: string };

  if (!message) {
    res.status(400).json({ success: false, message: 'message is required' });
    return;
  }

  const conn = getFiasConn();
  if (!conn) {
    res.status(503).json({ success: false, message: 'FIAS connection not established' });
    return;
  }

  conn.send(message);
  console.log(`[Lakeshore] test-fias-result sent: ${message}`);
  res.json({ success: true, sent: message });
});

export default router;
