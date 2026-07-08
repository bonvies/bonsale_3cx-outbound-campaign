import { fromZonedTime } from 'date-fns-tz';
import { FiasConn, FiasMessage } from '@call-schedule/types/fias/fiasTypes';
import { getDatabase } from '@call-schedule/services/database';
import { createCallSchedule, deleteCallSchedule, triggerImmediateCall } from '@/features/call-schedule/services/callService/callScheduleService';
import { getSiteTimezone } from '@call-schedule/util/timezone';
import { setFiasConn } from '@call-schedule/util/fiasConnectionStore';
import { sendLinkHandshake, sendLinkEnd, sendLinkAlive } from '@call-schedule/util/fiasLinkProtocol';
import { checkin, checkout, update, TollAllow } from '@call-schedule/services/api/freeSwitchPmsApi';

/**
 * FIAS 協定沒有前端，PMS 送來的是飯店當地時間（TI/DT），
 * 由此函式代為轉換成 UTC，再傳給 createCallSchedule 存入 DB。
 * （REST API 則由前端自行轉 UTC，後端只驗格式）
 *
 * FIAS DT（YYMMDD）+ TI（HHMM）→ 飯店時區 → UTC Date
 * 若 DT 未提供，預設使用當天；若時間已過則排明天
 */
async function parseFiasDate(ti: string, dt?: string): Promise<Date> {
  const timezone = await getSiteTimezone();
  const hour = parseInt(ti.substring(0, 2), 10);
  const minute = parseInt(ti.substring(2, 4), 10);

  let year: number, month: number, day: number;

  if (dt && dt.length >= 6) {
    // FIAS DT 格式：YYMMDD
    year = 2000 + parseInt(dt.substring(0, 2), 10);
    month = parseInt(dt.substring(2, 4), 10) - 1; // JS month 從 0 開始
    day = parseInt(dt.substring(4, 6), 10);
  } else {
    // 未提供日期：用今天，若已過則用明天
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth();
    day = now.getDate();

    const candidate = fromZonedTime(new Date(year, month, day, hour, minute, 0), timezone);
    if (candidate <= new Date()) {
      day += 1;
    }
  }

  return fromZonedTime(new Date(year, month, day, hour, minute, 0), timezone);
}

/**
 * GI/GO（住房異動）的設備閘門。
 *
 * 為什麼需要這個判斷：
 * GI/GO 的下游動作是「更新分機的通話權限（toll_allow）與顯示名稱」，
 * 這是透過 FusionPBX 主機上的 FIAS Middleware（freeSwitchPmsApi，port 5001）實現的，
 * 屬於 FreeSwitch 架構專屬能力——NewRock / Yeastar 目前沒有對應的分機權限開關機制，
 * 所以收到 GI/GO 時只 log 略過，不視為錯誤。
 *
 * GI/GO 本身是 FIAS 標準記錄類型（Oracle Hospitality spec），任何飯店的 PMS 都可能送，
 * 不是煙波專屬；換新飯店時只要設備同為 FreeSwitch/FusionPBX（該主機需部署 cdr-webhook
 * Middleware），調整 .env 即可直接沿用，程式碼不用改。
 *
 * TODO: 若未來 NewRock / Yeastar 也需要入住/退房連動（例如分機鎖定），
 *       應比照 IPhoneApiService 的模式把 checkin/checkout 抽象成裝置介面，
 *       屆時移除此閘門、改由各裝置實作決定行為。
 */
function isFreeSwitchEquipment(): boolean {
  return process.env.TELEPHONE_EQUIPMENT === 'FreeSwitch';
}

// GI/GC 的 CS（Class of Service）欄位 → 我方 TollAllow 對照。
// 見 Oracle Hospitality IFC8 FIAS Interface Specs「CS - Class of Service (COS)」章節：
// FIAS CS 為單一數字字元（0-3），意義與我方 CS0-CS3 依序對應：
//   0 Barred/hotel internal only → CS0（僅內線/緊急/免付費）
//   1 Local                      → CS1（CS0 + 市內）
//   2 National                   → CS2（CS1 + 國內＋行動）
//   3 No restrictions            → CS3（全部允許，含國際）
// GO（退房）規格裡沒有 CS 欄位（也沒有 GN），故不需要、也不能從 GO 訊息讀取
const VALID_FIAS_CS_CODES = ['0', '1', '2', '3'];
const DEFAULT_TOLL_ALLOW: TollAllow = 'CS2';

/** 解析 GI/GC 訊息的 CS 欄位；缺漏或非標準值時退回預設，並記錄原因 */
function resolveTollAllowFromFiasCs(cs: string | undefined, context: string): TollAllow {
  if (cs === undefined || cs === '') {
    console.log(`[FIAS] ${context} 未帶 CS 欄位，使用預設權限 ${DEFAULT_TOLL_ALLOW}`);
    return DEFAULT_TOLL_ALLOW;
  }
  if (!VALID_FIAS_CS_CODES.includes(cs)) {
    console.warn(`[FIAS] ${context} CS 欄位值無效："${cs}"（應為 0-3），使用預設權限 ${DEFAULT_TOLL_ALLOW}`);
    return DEFAULT_TOLL_ALLOW;
  }
  return `CS${cs}` as TollAllow;
}

/**
 * 根據 extension + 預定時間（UTC ISO）找尚未完成的 call_schedule 記錄
 */
function findScheduleId(extension: string, dateIso: string): string | null {
  const db = getDatabase();
  const row = db.prepare(
    `SELECT id FROM call_schedules
     WHERE extension = ? AND date = ?
     AND callStatus NOT IN ('ANSWERED', 'NO_ANSWER', 'ERROR')
     LIMIT 1`
  ).get(extension, dateIso) as { id: string } | undefined;
  return row?.id ?? null;
}

// ─────────────────────────────────────────────
// 主 Handler
// ─────────────────────────────────────────────
export default async function fiasHandler(msg: FiasMessage, conn: FiasConn): Promise<void> {
  switch (msg.type) {

    // 收到 PMS 的 LS：依規格必須回送完整 LD/LR/LA 握手序列（不能只回 LS），
    // PMS 才會脫離未定義狀態、開始真正處理資料記錄。與 fiasClient.ts（client 模式）
    // 共用同一套規則，見 fiasLinkProtocol.ts。
    case 'LS': {
      setFiasConn(conn);
      sendLinkHandshake(conn);
      break;
    }

    // 收到 PMS 的 LE（介面即將關閉）：依規格回送 LE 確認，與 fiasClient.ts 共用同一套規則
    case 'LE':
      sendLinkEnd(conn);
      break;

    case 'LA':
      sendLinkAlive(conn);
      break;

    // ── WR：叫醒預約 ──────────────────────────
    // 官方規格日期欄位是 DA（見 fiasLinkProtocol.ts LINK_RECORDS 說明），但
    // docs/FIAS_INTEGRATION.md 過去記錄的是 DT，兩者都沒實測驗證過，此處
    // DT 優先、缺漏時退回 DA，兩種都不漏接。RI/MR（重試間隔/次數）非官方欄位，
    // 缺漏時套用我方預設值（5 分鐘／3 次）。
    case 'WR': {
      const roomNumber = msg.fields.RN;
      const timeStr = msg.fields.TI;  // HHMM
      const dateStr = msg.fields.DT ?? msg.fields.DA;  // YYMMDD（可選）
      const retryIntervalMin = msg.fields.RI ?? '1';
      const maxRetries = msg.fields.MR ?? '1';

      const extensionPrefix = process.env.FIAS_EXTENSION_PREFIX ?? '';
      const extension = extensionPrefix + roomNumber;

      try {
        const jobDate = await parseFiasDate(timeStr, dateStr);

        // 規格：「PMS can be set to send wakeup requests in advance or right at
        // wakeup time」——若 Protel 是到點才送 WR，jobDate 經過處理延遲後可能已經
        // 等於或早於現在。createCallSchedule 遇到這種情況會直接 throw（date must be
        // in the future），叫醒電話會完全打不出去。這裡預留 1 分鐘緩衝，落在緩衝內
        // 的一律視為「該立刻撥打」，改用 triggerImmediateCall 直接撥出。
        const isDue = jobDate.getTime() <= Date.now() + 60_000;

        const newId = isDue
          ? await triggerImmediateCall({
            audioFile: '',
            extension,
            notificationContent: `叫醒服務 - 房間 ${roomNumber}`,
            retryInterval: retryIntervalMin,
            maxRetries,
            notes: `FIAS WR - 房間 ${roomNumber}`,
            roomNum: roomNumber,
          })
          : createCallSchedule({
            audioFile: '',
            date: jobDate.toISOString(),
            extension,
            notificationContent: `叫醒服務 - 房間 ${roomNumber}`,
            retryInterval: retryIntervalMin,
            maxRetries,
            notes: `FIAS WR - 房間 ${roomNumber}`,
            roomNum: roomNumber,
          });

        if (isDue) {
          console.log(`[FIAS] WR 撥打時間已到或在 1 分鐘緩衝內，改為立即撥打：房間=${roomNumber} 分機=${extension} 時間=${jobDate.toISOString()} retryInterval=${retryIntervalMin}min maxRetries=${maxRetries} id=${newId}`);
        } else {
          console.log(`[FIAS] WR 排程：房間=${roomNumber} 分機=${extension} 時間=${jobDate.toISOString()} retryInterval=${retryIntervalMin}min maxRetries=${maxRetries} id=${newId}`);
        }
        conn.send(`WC|RN${roomNumber}|ST1`);
      } catch (err) {
        console.error(`[FIAS] WR 處理失敗:`, err);
        conn.send(`WC|RN${roomNumber}|ST0`);
      }
      break;
    }

    // ── WC：取消叫醒（Wakeup Clear）──────────────
    // 日期欄位同 WR，DT 優先、缺漏時退回官方的 DA。
    case 'WC': {
      const roomNumber = msg.fields.RN;
      const timeStr = msg.fields.TI;
      const dateStr = msg.fields.DT ?? msg.fields.DA;

      const extensionPrefix = process.env.FIAS_EXTENSION_PREFIX ?? '';
      const extension = extensionPrefix + roomNumber;

      try {
        const jobDate = await parseFiasDate(timeStr, dateStr);
        const scheduleId = findScheduleId(extension, jobDate.toISOString());

        if (scheduleId) {
          deleteCallSchedule(scheduleId);
          console.log(`[FIAS] WC 取消叫醒：房間=${roomNumber} 分機=${extension} scheduleId=${scheduleId}`);
        } else {
          console.warn(`[FIAS] WC 找不到對應排程：房間=${roomNumber} 分機=${extension} 時間=${jobDate.toISOString()}`);
        }

        conn.send(`WC|RN${roomNumber}|ST1`);
      } catch (err) {
        console.error(`[FIAS] WC 處理失敗:`, err);
        conn.send(`WC|RN${roomNumber}|ST0`);
      }
      break;
    }

    // ── GI：客人入住（Guest In）──────────────
    // PMS 推送入住通知 → 開通房間分機的通話權限、把顯示名稱改為房客姓名
    case 'GI': {
      const roomNumber = msg.fields.RN;
      const guestName = msg.fields.GN; // 可能缺漏，缺漏時交給 Middleware 預設為 Room <分機>
      const csCode = msg.fields.CS;    // Class of Service，見上方 resolveTollAllowFromFiasCs 說明

      if (!roomNumber) {
        console.warn('[FIAS] GI 缺少房號（RN），忽略此訊息');
        break;
      }


      if (!isFreeSwitchEquipment()) {
        console.log(`[FIAS] GI 收到入住通知（房間=${roomNumber}），但 TELEPHONE_EQUIPMENT 非 FreeSwitch，略過分機權限更新`);
        break;
      }

      const extensionPrefix = process.env.FIAS_EXTENSION_PREFIX ?? '';
      const extension = extensionPrefix + roomNumber;
      const tollAllow = resolveTollAllowFromFiasCs(csCode, `GI（房間=${roomNumber}）`);

      // FIAS GI 不需回覆業務層 ACK，失敗只 log（不中斷 FIAS 連線）
      const result = await checkin(extension, guestName ?? `Room ${extension}`, tollAllow);
      if (result.success) {
        console.log(`[FIAS] GI check-in 完成：房間=${roomNumber} 分機=${extension} 房客=${guestName ?? '(未提供)'} 權限=${tollAllow}`);
      } else {
        console.error(`[FIAS] GI check-in 失敗（房間=${roomNumber} 分機=${extension}）:`, result.error);
      }
      break;
    }

    // ── GO：客人退房（Guest Out）─────────────
    // PMS 推送退房通知 → 收回房間分機的通話權限、顯示名稱還原為 Room <分機>
    case 'GO': {
      const roomNumber = msg.fields.RN;

      if (!roomNumber) {
        console.warn('[FIAS] GO 缺少房號（RN），忽略此訊息');
        break;
      }
      if (!isFreeSwitchEquipment()) {
        console.log(`[FIAS] GO 收到退房通知（房間=${roomNumber}），但 TELEPHONE_EQUIPMENT 非 FreeSwitch，略過分機權限更新`);
        break;
      }

      const extensionPrefix = process.env.FIAS_EXTENSION_PREFIX ?? '';
      const extension = extensionPrefix + roomNumber;

      const result = await checkout(extension);
      if (result.success) {
        console.log(`[FIAS] GO check-out 完成：房間=${roomNumber} 分機=${extension}`);
      } else {
        console.error(`[FIAS] GO check-out 失敗（房間=${roomNumber} 分機=${extension}）:`, result.error);
      }
      break;
    }

    // ── GC：住客資料異動 / 換房（Guest Change / Room Move）──
    // 見 Oracle IFC8 FIAS Interface Specs「Guest Data Change notification」：
    // RN = 目的房號（換房時的新房），RO = 來源房號（換房時的舊房，「支援換房流程的系統必填」）。
    // 有 RO 才代表這是真的換房；沒有 RO 只是單純資料異動（例如改房客姓名），非本次範圍不處理。
    case 'GC': {
      const newRoomNumber = msg.fields.RN;
      const oldRoomNumber = msg.fields.RO;
      const guestName = msg.fields.GN;
      const csCode = msg.fields.CS;

      if (!oldRoomNumber) {
        console.log(`[FIAS] GC 純資料異動（非換房，暫不處理）:`, JSON.stringify(msg.fields));
        break;
      }
      if (!newRoomNumber) {
        console.warn('[FIAS] GC 換房訊息缺少新房號（RN），忽略此訊息');
        break;
      }
      if (!isFreeSwitchEquipment()) {
        console.log(`[FIAS] GC 收到換房通知（${oldRoomNumber} → ${newRoomNumber}），但 TELEPHONE_EQUIPMENT 非 FreeSwitch，略過分機權限更新`);
        break;
      }

      const extensionPrefix = process.env.FIAS_EXTENSION_PREFIX ?? '';
      const oldExtension = extensionPrefix + oldRoomNumber;
      const newExtension = extensionPrefix + newRoomNumber;
      const tollAllow = resolveTollAllowFromFiasCs(csCode, `GC 換房（${oldRoomNumber} → ${newRoomNumber}）`);

      // 換房 = 舊房退房 + 新房入住，依序執行。先收回舊房權限再開新房，
      // 避免退房前有一段時間新舊兩間房同時具備通話權限（例如舊房卡片還沒收回）。
      // 舊房退房失敗仍繼續處理新房入住——客人已經實際搬過去，不該因此打不了電話。
      const checkoutResult = await checkout(oldExtension);
      if (!checkoutResult.success) {
        console.error(`[FIAS] GC 換房：舊房退房失敗（房間=${oldRoomNumber} 分機=${oldExtension}）:`, checkoutResult.error);
      }

      const checkinResult = await checkin(newExtension, guestName ?? `Room ${newExtension}`, tollAllow);
      if (checkinResult.success) {
        console.log(`[FIAS] GC 換房完成：${oldRoomNumber}（分機=${oldExtension}）→ ${newRoomNumber}（分機=${newExtension}）房客=${guestName ?? '(未提供)'} 權限=${tollAllow}`);
      } else {
        console.error(`[FIAS] GC 換房：新房入住失敗（房間=${newRoomNumber} 分機=${newExtension}）:`, checkinResult.error);
      }
      break;
    }

    // ── RE：分機設備狀態（Room Equipment）──────
    // 見 Oracle IFC8 FIAS Interface Specs「RE - Room equipment status」：這裡只處理
    // DN（Do-Not-Disturb，From PMS）方向。RS（我方主動回報房況給 Protel）走的是
    // routes/hotel/lakeshore.ts 的 /room/status，跟這裡收到的 RE 是完全不同流向，不會衝突。
    // 純轉發：DND 開啟後的實際擋話行為由 FreeSwitch/FusionPBX middleware 負責，我方不做判斷。
    // 註：規格上 CS 欄位也可能透過 RE 單獨送達（不經過 GI/GC），目前尚未確認 Protel 是否採此模式，暫不處理。
    case 'RE': {
      const roomNumber = msg.fields.RN;
      const dnFlag = msg.fields.DN; // Y/N

      if (!roomNumber) {
        console.warn('[FIAS] RE 缺少房號（RN），忽略此訊息');
        break;
      }
      if (dnFlag === undefined) {
        console.log(`[FIAS] RE 收到（房間=${roomNumber}），未帶 DN 欄位，忽略（目前只處理 DND）`);
        break;
      }
      if (!isFreeSwitchEquipment()) {
        console.log(`[FIAS] RE 收到 DND 通知（房間=${roomNumber}），但 TELEPHONE_EQUIPMENT 非 FreeSwitch，略過`);
        break;
      }

      const extensionPrefix = process.env.FIAS_EXTENSION_PREFIX ?? '';
      const extension = extensionPrefix + roomNumber;
      const doNotDisturb = dnFlag === 'Y';

      const result = await update({ extension, doNotDisturb });
      if (result.success) {
        console.log(`[FIAS] RE DND 更新完成：房間=${roomNumber} 分機=${extension} DND=${doNotDisturb}`);
      } else {
        console.error(`[FIAS] RE DND 更新失敗（房間=${roomNumber} 分機=${extension}）:`, result.error);
      }
      break;
    }

    default:
      console.warn(`[FIAS] 未知訊息類型: ${msg.type}`);
  }
}
