import express, { Router, Request, Response } from 'express';
import { fromZonedTime } from 'date-fns-tz';
import { getFiasConn } from '../../util/fiasConnectionStore';
import { getSiteTimezone } from '../../util/timezone';

const router: Router = express.Router();

// 房務狀態代碼（《房務狀態串接開發規格書》4.1-3）
const VALID_ROOM_STATUSES = ['0', '1', '2', '4', '5', '6'];
// statustime 早於「現在-10分」視為過期（規格書 4.3-5）
const STATUSTIME_MAX_AGE_MS = 10 * 60 * 1000;

// 煙波 roomstatus → FIAS 標準 RS（Room Maid Status，見 Oracle FIAS spec Appendix B）
// FIAS RS 代碼：1=Dirty/Vacant 2=Dirty/Occupied 3=Clean/Vacant 4=Clean/Occupied 5=Inspected/Vacant 6=Inspected/Occupied
// 煙波沒有回報房間是否有客人入住，以下一律假設 Vacant，且無法一一對應，為我方暫定，待實測後調整：
//   0 cleaned              → 3 Clean/Vacant
//   1 dirty                → 1 Dirty/Vacant
//   2 out of service        → FIAS 規格明確表示無法由外部系統設定此狀態（只能在 PMS 本身操作），先送 2 觀察 Protel 實際反應
//   4 touched              → 2 Dirty/Occupied（假設「已被使用」）
//   5 cleaning in progress → 1 Dirty/Vacant（尚未清潔完成）
//   6 checked              → 5 Inspected/Vacant
const ROOM_STATUS_TO_FIAS_RS: Record<string, string> = {
  '0': '3',
  '1': '1',
  '2': '2',
  '4': '2',
  '5': '1',
  '6': '5',
};

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

function respond(res: Response, retcode: string): void {
  res.json({ retcode, msg: RETCODE_MSG[retcode] });
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

    // 檢核白名單
    const clientIp = req.ip ?? req.socket.remoteAddress ?? '';
    if (!isWhitelisted(clientIp)) {
      console.warn(`[Lakeshore] 拒絕非白名單 IP: ${clientIp}`);
      respond(res, '003');
      return;
    }

    const { roomno, statustime } = req.body;
    // 規格書欄位表寫 roomstatus，但 JSON 範例卻用 status，兩者皆接受
    const roomstatus = req.body.roomstatus ?? req.body.status;

    if (!roomno || roomstatus === undefined || roomstatus === null || roomstatus === '' || !statustime) {
      respond(res, '004');
      return;
    }

    if (!VALID_ROOM_STATUSES.includes(String(roomstatus))) {
      respond(res, '002');
      return;
    }

    // TODO(4.3-4): 檢核房號於 3CX 是否存在 → retcode 005；目前先略過，待決定檢核方式後補上

    const timezone = await getSiteTimezone();
    const statusDate = parseStatusTime(statustime, timezone);
    if (!statusDate || statusDate.getTime() < Date.now() - STATUSTIME_MAX_AGE_MS) {
      respond(res, '006');
      return;
    }

    // 轉發給 Protel（FIAS TCP，RE/RS 記錄，fire-and-forget：暫不等待 PMS 回應結果，見 docs/FIAS_INTEGRATION.md）
    const conn = getFiasConn();
    if (conn) {
      const fiasRs = ROOM_STATUS_TO_FIAS_RS[String(roomstatus)];
      if (String(roomstatus) === '2') {
        console.warn(`[Lakeshore] roomstatus=2 (out of service) 依 FIAS 規格無法由外部系統設定，仍嘗試送出以觀察 Protel 實際反應（房間=${roomno}）`);
      }
      conn.send(`RE|RN${roomno}|RS${fiasRs}|`);
      console.log(`RE|RN${roomno}|RS${fiasRs}|`);
      console.log(`[Lakeshore] 房況已轉發給 Protel：房間=${roomno} 煙波狀態=${roomstatus} → FIAS RS=${fiasRs}`);
    } else {
      console.warn(`[Lakeshore] FIAS 未連線，房況無法轉發給 Protel（房間=${roomno} 狀態=${roomstatus}）`);
    }

    respond(res, '000');
  } catch (error) {
    console.error('[Lakeshore] POST /room/status error:', error);
    respond(res, '999');
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
