import { fromZonedTime } from 'date-fns-tz';
import { PmsMessage as FiasMessage, PmsConn as FiasConn } from '@call-schedule/types/pms/pmsTypes';
import { getDatabase } from '@call-schedule/services/database';
import { createCallSchedule, deleteCallSchedule } from '@call-schedule/services/callScheduleService';
import { getBonsaleCompanySys } from '@shared-local/services/api/bonsale';
import { logWithTimestamp, warnWithTimestamp } from '@/shared/util/timestamp';

/**
 * FIAS 協定沒有前端，PMS 送來的是飯店當地時間（TI/DT），
 * 由此函式代為轉換成 UTC，再傳給 createCallSchedule 存入 DB。
 * （REST API 則由前端自行轉 UTC，後端只驗格式）
 *
 * FIAS DT（YYMMDD）+ TI（HHMM）→ 飯店時區 → UTC Date
 * 若 DT 未提供，預設使用當天；若時間已過則排明天
 */
async function parseFiasDate(ti: string, dt?: string): Promise<Date> {
  const bonsaleCompanySys = await getBonsaleCompanySys();
  const timezone = bonsaleCompanySys?.data?.timezoneIANA ?? 'UTC';

  const hour   = parseInt(ti.substring(0, 2), 10);
  const minute = parseInt(ti.substring(2, 4), 10);

  let year: number, month: number, day: number;

  // new Date(y, m, d, h, min) 以本機時區建立日期，fromZonedTime 讀取其本機時間值，
  // 視為指定時區的當地時間並轉換為 UTC
  const toUtc = (y: number, m: number, d: number) =>
    fromZonedTime(new Date(y, m, d, hour, minute, 0), timezone);

  if (dt && dt.length >= 6) {
    // FIAS DT 格式：YYMMDD
    year  = 2000 + parseInt(dt.substring(0, 2), 10);
    month = parseInt(dt.substring(2, 4), 10) - 1; // JS month 從 0 開始
    day   = parseInt(dt.substring(4, 6), 10);
  } else {
    // 未提供日期：用今天，若已過則用明天
    const now = new Date();
    year  = now.getFullYear();
    month = now.getMonth();
    day   = now.getDate();

    if (toUtc(year, month, day) <= new Date()) {
      day += 1;
    }
  }

  return toUtc(year, month, day);
}

/**
 * 根據 extension + 預定時間（UTC ISO）找尚未完成的 call_schedule 記錄
 */
function findScheduleId(extension: string, dateIso: string): string | null {
  const db = getDatabase();
  const row = db.prepare(
    `SELECT id FROM call_schedules
     WHERE extension = ? AND date = ?
     AND callStatus NOT IN ('已接聽', '未接聽', '錯誤')
     LIMIT 1`
  ).get(extension, dateIso) as { id: string } | undefined;
  return row?.id ?? null;
}

// ─────────────────────────────────────────────
// 共用業務邏輯
// ─────────────────────────────────────────────

async function handleWakeUpCreate(
  fields: Record<string, string>,
  logPrefix = 'WR',
): Promise<void> {
  const roomNumber       = fields.RN;
  const timeStr          = fields.TI;  // HHMM
  const dateStr          = fields.DT;  // YYMMDD（可選）
  const retryIntervalMin = fields.RI ?? '5';
  const maxRetries       = fields.MR ?? '3';

  const extensionPrefix = process.env.FIAS_EXTENSION_PREFIX ?? '';
  const extension       = extensionPrefix + roomNumber;

  // FIAS 規範：WR 不需要回應，叫醒執行結果另由 WA 送出
  const jobDate = await parseFiasDate(timeStr, dateStr);

  const newId = createCallSchedule({
    audioFile: '',
    date: jobDate.toISOString(),
    extension,
    notificationContent: `叫醒服務 - 房間 ${roomNumber}`,
    retryInterval: retryIntervalMin,
    maxRetries,
    notes: `FIAS ${logPrefix} - 房間 ${roomNumber}`,
  });

  logWithTimestamp(`[FIAS] ${logPrefix} 預約叫醒：房間=${roomNumber} 分機=${extension} 時間=${jobDate.toISOString()} retryInterval=${retryIntervalMin}min maxRetries=${maxRetries} id=${newId}`);
}

async function handleWakeUpDelete(
  fields: Record<string, string>,
  logPrefix = 'WC',
): Promise<void> {
  const roomNumber = fields.RN;
  const timeStr    = fields.TI;
  const dateStr    = fields.DT;

  const extensionPrefix = process.env.FIAS_EXTENSION_PREFIX ?? '';
  const extension       = extensionPrefix + roomNumber;

  // FIAS 規範：WC 不需要回應
  const jobDate    = await parseFiasDate(timeStr, dateStr);
  const scheduleId = findScheduleId(extension, jobDate.toISOString());

  if (scheduleId) {
    deleteCallSchedule(scheduleId);
    logWithTimestamp(`[FIAS] ${logPrefix} 取消叫醒：房間=${roomNumber} 分機=${extension} scheduleId=${scheduleId}`);
  } else {
    warnWithTimestamp(`[FIAS] ${logPrefix} 找不到對應排程：房間=${roomNumber} 分機=${extension} 時間=${jobDate.toISOString()}`);
  }
}

// ─────────────────────────────────────────────
// 主 Handler
// ─────────────────────────────────────────────
export default async function fiasHandler(msg: FiasMessage, conn: FiasConn): Promise<void> {
  switch (msg.type) {

    case 'LS': {
      // PMS 開啟連線後發出的第一條訊息一定是 LS（Link Start）
      // 設備必須回傳 LD（Link Description）告知自身日期時間，啟動初始化序列
      // ⚠️ 注意：回傳的是 LD，不是 LS；舊版此處誤寫為 'LS|...'
      const now = new Date();
      const yy  = String(now.getFullYear()).slice(-2);         // 年份後兩位
      const mm  = String(now.getMonth() + 1).padStart(2, '0');
      const dd  = String(now.getDate()).padStart(2, '0');
      const hh  = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');
      const ss  = String(now.getSeconds()).padStart(2, '0');
      const da  = `${yy}${mm}${dd}`;  // FIAS DT 格式：YYMMDD
      const ti  = `${hh}${min}${ss}`; // FIAS TI 格式：HHMMSS
      logWithTimestamp(`[FIAS] 收到 LS，回傳 LD（Link Description）DA=${da} TI=${ti}`);
      conn.send(`LD|DA${da}|TI${ti}`);
      break;
    }

    case 'LA':
      // PMS 在 LR 記錄傳送完畢後發送 LA（Link Active），代表鏈路進入活躍狀態
      // 設備回傳 LA 作為確認，雙方正式進入業務資料交換模式
      logWithTimestamp('[FIAS] 收到 LA，回傳 LA 確認，鏈路初始化完成');
      conn.send('LA');
      break;

    // ── WR：叫醒預約 ──────────────────────────
    case 'WR':
      await handleWakeUpCreate(msg.fields);
      break;

    // ── WC：取消叫醒（Wakeup Clear）─────────
    // 注意：WC 在此是 PMS → 設備的指令，不是設備的回應
    case 'WC':
      await handleWakeUpDelete(msg.fields);
      break;

    // ── LR：初始化同步記錄 ────────────────────
    // PMS 連線後會用 LR 把現有記錄全部同步過來
    // 格式：LR|WR|RN101|TI0730  或  LR|WC|RN101|TI0730
    // 解析後 fields 會帶有 WR 或 WC 這個空值 key 來標記內層類型
    case 'LR': {
      if ('WR' in msg.fields) {
        await handleWakeUpCreate(msg.fields, 'LR/WR');
      } else if ('WC' in msg.fields) {
        await handleWakeUpDelete(msg.fields, 'LR/WC');
      } else {
        warnWithTimestamp('[FIAS] LR 無法判斷內層類型:', msg.fields);
      }
      break;
    }

    // ── LE：初始化同步結束 ────────────────────
    case 'LE':
      logWithTimestamp('[FIAS] 初始記錄同步完成');
      break;

    // ── ACK/NAK：傳輸層確認 ───────────────────
    case 'ACK':
      // PMS 確認收到我們的回應，不需要動作
      break;

    case 'NAK':
      // PMS 要求重送，目前先記錄，未來可補重送機制
      warnWithTimestamp('[FIAS] 收到 NAK，PMS 要求重送（尚未實作重送）');
      break;

    default:
      warnWithTimestamp(`[FIAS] 未知訊息類型: ${msg.type}`);
  }
}
