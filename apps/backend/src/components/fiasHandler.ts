import { fromZonedTime } from 'date-fns-tz';
import { FiasConn, FiasMessage } from '@/types/fias/fiasTypes';
import { getDatabase } from '@/services/database';
import { createCallSchedule, deleteCallSchedule } from '@/services/callScheduleService';
import { getBonsaleCompanySys } from '@/services/api/bonsale';

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

    const candidate = fromZonedTime(new Date(year, month, day, hour, minute, 0), timezone);
    if (candidate <= new Date()) {
      day += 1;
    }
  }

  return fromZonedTime(new Date(year, month, day, hour, minute, 0), timezone);
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
// 主 Handler
// ─────────────────────────────────────────────
export default async function fiasHandler(msg: FiasMessage, conn: FiasConn): Promise<void> {
  switch (msg.type) {

    case 'LS':
      console.log('[FIAS] 執行握手程序...');
      conn.send('LS|DA260226|TI120000');
      break;

    case 'LA':
      conn.send('LA');
      break;

    // ── WR：叫醒預約 ──────────────────────────
    case 'WR': {
      const roomNumber       = msg.fields.RN;
      const timeStr          = msg.fields.TI;  // HHMM
      const dateStr          = msg.fields.DT;  // YYMMDD（可選）
      const retryIntervalMin = msg.fields.RI ?? '5';
      const maxRetries       = msg.fields.MR ?? '3';

      const extensionPrefix = process.env.FIAS_EXTENSION_PREFIX ?? '';
      const extension       = extensionPrefix + roomNumber;

      try {
        const jobDate = await parseFiasDate(timeStr, dateStr);

        const newId = createCallSchedule({
          audioFile: '',
          date: jobDate.toISOString(),
          extension,
          notificationContent: `叫醒服務 - 房間 ${roomNumber}`,
          retryInterval: retryIntervalMin,
          maxRetries,
          notes: `FIAS WR - 房間 ${roomNumber}`,
        });

        console.log(`[FIAS] WR 預約叫醒：房間=${roomNumber} 分機=${extension} 時間=${jobDate.toISOString()} retryInterval=${retryIntervalMin}min maxRetries=${maxRetries} id=${newId}`);
        conn.send(`WC|RN${roomNumber}|ST1`);
      } catch (err) {
        console.error(`[FIAS] WR 處理失敗:`, err);
        conn.send(`WC|RN${roomNumber}|ST0`);
      }
      break;
    }

    // ── WD：取消叫醒 ──────────────────────────
    case 'WD': {
      const roomNumber = msg.fields.RN;
      const timeStr    = msg.fields.TI;
      const dateStr    = msg.fields.DT;

      const extensionPrefix = process.env.FIAS_EXTENSION_PREFIX ?? '';
      const extension       = extensionPrefix + roomNumber;

      try {
        const jobDate    = await parseFiasDate(timeStr, dateStr);
        const scheduleId = findScheduleId(extension, jobDate.toISOString());

        if (scheduleId) {
          deleteCallSchedule(scheduleId);
          console.log(`[FIAS] WD 取消叫醒：房間=${roomNumber} 分機=${extension} scheduleId=${scheduleId}`);
        } else {
          console.warn(`[FIAS] WD 找不到對應排程：房間=${roomNumber} 分機=${extension} 時間=${jobDate.toISOString()}`);
        }

        conn.send(`WC|RN${roomNumber}|ST1`);
      } catch (err) {
        console.error(`[FIAS] WD 處理失敗:`, err);
        conn.send(`WC|RN${roomNumber}|ST0`);
      }
      break;
    }

    default:
      console.warn(`[FIAS] 未知訊息類型: ${msg.type}`);
  }
}
