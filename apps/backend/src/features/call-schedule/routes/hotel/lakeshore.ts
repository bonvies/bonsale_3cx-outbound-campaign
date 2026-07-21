import express, { Router, Request, Response } from 'express';
import { fromZonedTime } from 'date-fns-tz';
import { getFiasConn } from '../../util/fiasConnectionStore';
import { getSiteTimezone } from '../../util/timezone';
import { checkin, checkout, update, TollAllow } from '../../services/api/freeSwitchPmsApi';
import fiasHandler from '../../components/fiasHandler';
import { FiasConn } from '../../types/fias/fiasTypes';
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

// 客房電話撥打功能碼回報房況（見《Room Status Middleware JSON 規格》）：
// **12 清潔完成 / **13 已檢查 / **14 清潔中，這裡的代碼對照表是 Bonuc 那份文件
// 自己定義的建議值，跟上面 /room/status 直接使用煙波原始代碼（不轉換）是兩回事，
// 不要混用。
const ROOM_PHONE_STATUS_CODE_MAP: Record<string, string> = {
  clean: '0',
  inspected: '6',
  cleaning: '5',
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

// Node 沒有明確指定只監聽 IPv4 時是雙棧監聽，req.ip 對 IPv4 連線會回傳
// IPv4-mapped IPv6 格式（例如 ::ffff:172.16.0.51），跟白名單裡常見的純 IPv4
// 寫法（172.16.0.51）對不上——2026-07-21 煙波房務系統 API 呼叫證實過這個問題，
// 白名單設定正確、IP 也對，仍被擋下。比對前先去掉這個前綴。
function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

// 檢核白名單（完全相等比對，不能改成子字串 includes——會被子字串包含關係繞過白名單）
function isWhitelisted(ip: string): boolean {
  const whitelist = (process.env.LAKESHORE_IP_WHITELIST ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (whitelist.length === 0) return true;
  return whitelist.includes(normalizeIp(ip));
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

// POST /api/v1/lakeshore/room/status/phone
//
// 客房電話撥打房況功能碼（**12/**13/**14）的回報端點，來源是 Bonuc 的地端
// middleware（FreeSWITCH dialplan → Lua → cdr_webhook → 這裡），不是煙波房務系統
// 直接推送，所以跟上面的 /room/status 是兩支獨立端點：欄位命名、房況值型別（這裡
// 是文字 clean/inspected/cleaning，不是數字代碼）、回應格式都不一樣，見《Room
// Status Middleware JSON 規格》。最終效果一致：都是驗證後透過既有 FIAS TCP 連線
// 送 RE|RN房號|RS代碼| 給 Protel PMS。
//
// 必填：domain_name、room_number、status、source_code；選填：source、time
//（與主管確認過的欄位需求，2026-07-20）。
//
// TODO: 目前沒有做 IP 白名單檢核——來源是 Bonuc 的伺服器，不是 Protel，既有的
// LAKESHORE_IP_WHITELIST（給 Protel 用）不適用。等拿到 Bonuc 實際來源 IP 後，
// 補一組獨立的白名單環境變數（例如 LAKESHORE_ROOM_PHONE_STATUS_IP_WHITELIST）。
router.post('/room/status/phone', async (req: Request, res: Response) => {
  try {
    console.log('[Lakeshore] ===== Incoming Room Phone Status Request =====');
    console.log('[Lakeshore] Body:', JSON.stringify(req.body, null, 2));

    const { domain_name, room_number, status, source, source_code, time } = req.body;

    // source 只記錄稽核用途，不做驗證：依規格固定是 room_phone，沒有分支邏輯
    console.log(`[Lakeshore] room/status/phone 來源資訊: domain_name=${domain_name} source=${source} source_code=${source_code}`);

    // 檢核必填欄位（time、source 為選填）
    if (!domain_name || !room_number || !status || !source_code) {
      res.status(400).json({ success: false, message: 'domain_name, room_number, status and source_code are required' });
      return;
    }

    // 檢核 status 是否為有效值（見《Room Status Middleware JSON 規格》第三節）
    const statusCode = ROOM_PHONE_STATUS_CODE_MAP[String(status)];
    if (!statusCode) {
      res.status(400).json({ success: false, message: `invalid status: ${status}` });
      return;
    }

    // 檢核房號是否存在（room_number 全程當字串處理，避免 0301 被轉成數字 301）
    if (!LAKESHORE_ROOM_NUMBERS.has(String(room_number))) {
      res.status(400).json({ success: false, message: `unknown room_number: ${room_number}` });
      return;
    }

    // time 為選填欄位：沒給就跳過新鮮度檢查；有給才驗證格式與新鮮度
    //（格式跟 /room/status 的 statustime 完全一樣，重用同一套解析邏輯）
    if (time !== undefined && time !== null && time !== '') {
      const timezone = await getSiteTimezone();
      const statusDate = parseStatusTime(time, timezone);
      if (!statusDate || statusDate.getTime() < Date.now() - STATUSTIME_MAX_AGE_MS) {
        res.status(400).json({ success: false, message: `invalid or stale time: ${time}` });
        return;
      }
    }

    // 轉發給 Protel（FIAS TCP，RE/RS 記錄，fire-and-forget：即使 FIAS 未連線也仍回應成功，
    // 跟 /room/status 一致，呼叫端不需要知道 FIAS 連線狀態）
    const conn = getFiasConn();
    if (conn) {
      conn.send(`RE|RN${room_number}|RS${statusCode}|`);
      console.log(`[Lakeshore] 房況已轉發給 Protel：房間=${room_number} status=${status} → FIAS RS=${statusCode}`);
    } else {
      console.warn(`[Lakeshore] FIAS 未連線，房況無法轉發給 Protel（房間=${room_number} status=${status}）`);
    }

    res.json({
      success: true,
      message: 'room_status_updated',
      domain_name,
      room_number,
      status,
      status_code: Number(statusCode),
    });
  } catch (error) {
    console.error('[Lakeshore] POST /room/status/phone error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
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

    const { room_number, guest_name, toll_allow, guest_language } = req.body;
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

    // guest_language 對應 FIAS GL（Guest Language）欄位，選填，原樣透傳給 Middleware
    const result = await checkin(String(room_number), String(guest_name), resolvedTollAllow, guest_language !== undefined ? String(guest_language) : undefined);
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
//
// 【方向】我方 → PMS（模擬「我方主動送出」的訊息，例如 PS 電話計費）。
// 【做法】完全不解析、不驗證內容，直接把 message 原封不動透過現有的 FIAS TCP 連線
//         （getFiasConn()）送出去，交給 conn.send() 自動包上 STX/ETX 信封後送出。
// 【用途】確認 FIAS TCP 連線本身是否還活著、能不能正常送出資料（純粹的通道健檢），
//         不會觸發我方任何業務邏輯（不會經過 fiasHandler.ts）。
// 【前提】必須已經有一條建立好的 FIAS 連線（不管是我方當 server 被 PMS 連進來，
//         還是我方當 client 連到 PMS），否則 getFiasConn() 回傳 null，回 503。
// 【風險】訊息會真的送到當前連線的另一端。如果連線對象是真實 PMS（例如正式環境
//         連著煙波的 Protel），送出格式不對的訊息可能讓對方系統誤判（先前就發生過
//         誤送 WC 被 Protel 當成真的取消叫醒、多記一筆「Deleted from room X」的案例，
//         詳見 docs/FIAS_LAKESHORE_TEST_LOG.md）。不要用來測試 GI/GO（check-in/
//         check-out）——那兩種是規格上「PMS 送給我方」的方向，送反了對面不會如預期反應，
//         要測 check-in/check-out 請用下面的 test-fias-message。
// Body: { message: string }，例如 "PS|RN0330|PTC|TA500|DA260709|TI155638|..."（原始封包內容，
//        不含 STX/ETX，conn.send() 會自動加上）
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

// POST /api/v1/lakeshore/test-fias-message
//
// 【方向】PMS → 我方（模擬「PMS 送進來」的訊息，例如 GI/GO/RE/WR...），跟上面
//         test-fias-result（我方送出去）方向完全相反，兩者不要搞混。
// 【做法】不碰任何 TCP 連線（不需要真的連著 PMS，getFiasConn() 是否有值都無關），
//         直接把 message 解析成 { type, fields }（規則跟 fias.ts/fiasClient.ts 收到
//         真實封包時一致：用 '|' 切割，第一段是訊息類型，其餘每段前 2 字元是欄位
//         代碼、其後是值），然後直接呼叫正式的 fiasHandler(msg, conn) —— 跟真的
//         收到 PMS 訊息時走的是同一個函式、同一條程式碼路徑，不是另外模擬一套。
// 【用途】驗證我方收到特定業務訊息後的處理邏輯是否正確，尤其是 GI/GO（check-in/
//         check-out）：呼叫這個 API 就會真的觸發 fiasHandler.ts 的 case 'GI'/'GO'，
//         進而呼叫 freeSwitchPmsApi.ts 的 checkin()/checkout()。
// 【風險】checkin()/checkout() 會打真的 FREESWITCH_PMS_API_URL（見 .env），對訊息裡
//         RN 指定的房號分機做真實的 caller ID／通話權限異動，不是假的模擬回應。
//         但這個過程完全不會碰到 Protel PMS 本身或真實 FIAS TCP 連線，只會影響
//         FreeSwitch/FusionPBX 那一端的分機設定，即使誤送也不會弄出假訂房。
// 【不驗證的部分】不會走 LS/LD/LR/LA 握手（GI/GO/RE 等業務記錄本來就不需要），
//         也不驗證訊息是否符合 fiasLinkProtocol.ts 宣告的欄位範圍——這裡只測
//         fiasHandler.ts 收到訊息之後的業務邏輯，不測連線/握手層。
// Body: { message: string }，例如 "GI|RN0330|G#3934582|GN測試|CS0|DA260709|TI141628|"
//        （跟 test-fias-result 一樣是不含 STX/ETX 的原始封包內容，但這裡的方向和用途相反）
router.post('/test-fias-message', async (req: Request, res: Response) => {
  const { message } = req.body as { message?: string };

  if (!message) {
    res.status(400).json({ success: false, message: 'message is required' });
    return;
  }

  const parts = message.split('|');
  const type = parts[0];
  if (!type) {
    res.status(400).json({ success: false, message: 'invalid FIAS message: missing type' });
    return;
  }

  const fields: Record<string, string> = {};
  parts.slice(1).forEach((f) => {
    fields[f.substring(0, 2)] = f.substring(2);
  });

  // GI/GO 等業務記錄依規格不需回覆，這裡只是攔截 handler 可能送出的內容方便觀察
  // （例如測 WR 時會觸發 fiasWakeupResultHandler 相關流程）
  const handlerSentMessages: string[] = [];
  const conn: FiasConn = {
    send(content: string): void {
      handlerSentMessages.push(content);
      console.log(`[Lakeshore] test-fias-message 觸發 handler 送出: ${content}`);
    },
  };

  try {
    console.log(`[Lakeshore] test-fias-message 收到: ${message} → 解析為`, { type, fields });
    await fiasHandler({ type, fields }, conn);
    res.json({ success: true, parsed: { type, fields }, handlerSentMessages });
  } catch (error) {
    console.error('[Lakeshore] POST /test-fias-message error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
