import { ICallResultHandler, CallResultPayload, CallFinalStatus } from '../services/callService/monitor/callResultNotifier';
import { getCallScheduleById } from '../services/callService/callScheduleService';
import { getFiasConn } from '../util/fiasConnectionStore';

// finalStatus → FIAS Answer Status（見 Oracle Hospitality IFC8 FIAS Interface Specs
// 「AS - Answer Statuses」）：OK=成功接聽，NR=No Response（未接聽），
// UR=Unprocessable request, no retry（我方系統本身撥打失敗，非電話無回應）
const FINAL_STATUS_TO_AS: Record<CallFinalStatus, string> = {
  ANSWERED: 'OK',
  NO_ANSWER: 'NR',
  ERROR: 'UR',
};

// 這是「協定層級」的 handler，不是「客戶層級」的——任何用 FIAS PMS（Protel/Opera/
// Fidelio...）的飯店都需要同一套 WA 回報邏輯，不因換客戶而不同，所以只在 app.ts
// 依 ENABLE_FIAS 註冊，不是「新增飯店就複製一份」。若某飯店需要真正客製化的通知方式
// （例如結果要另外 POST 到該飯店自己的系統），才在旁邊新增一個 ICallResultHandler
// （例如 lakeshoreCustomNotifyHandler.ts），跟這個各自獨立註冊，互不影響。
export class FiasWakeupResultHandler implements ICallResultHandler {
  async handle(payload: CallResultPayload): Promise<void> {
    const conn = getFiasConn();
    if (!conn) {
      console.warn('[FiasWakeupResult] FIAS conn 不存在，無法回傳通話結果');
      return;
    }

    const record = await getCallScheduleById(payload.scheduleId);
    if (!record) {
      console.warn(`[FiasWakeupResult] 找不到 call_schedule 記錄（id=${payload.scheduleId}），無法回傳 WA`);
      return;
    }

    // 只有源自 FIAS WR 的排程才需要回報 WA；一般 REST API 建立的排程（非叫醒服務）
    // 不應該送 WA 給 PMS，否則會告知一筆 Protel 從未請求過的叫醒結果。
    if (!record.notes?.startsWith('FIAS WR')) {
      return;
    }

    const prefix = process.env.FIAS_EXTENSION_PREFIX ?? '';
    const roomNum = record.roomNum
      ?? (prefix && payload.extension.startsWith(prefix) ? payload.extension.slice(prefix.length) : payload.extension);

    // record.date 已由 getCallScheduleById 轉為飯店當地時間的 ISO 字串
    // （"yyyy-MM-ddTHH:mm:ss.SSSxxx"），規格要求 TI 必須是原始叫醒時間，不是系統現在時間。
    const da = record.date.slice(2, 10).replace(/-/g, ''); // YYMMDD
    const ti = record.date.slice(11, 19).replace(/:/g, ''); // HHMMSS
    const answerStatus = FINAL_STATUS_TO_AS[payload.finalStatus];

    // WA 為標準 FIAS 叫醒結果記錄；規格規定同一次叫醒只能送一筆最終結果，不可送中間結果
    conn.send(`WA|RN${roomNum}|DA${da}|TI${ti}|AS${answerStatus}|`);
    console.log(`[FiasWakeupResult] FIAS WA 已送出：房間=${roomNum} 時間=${da} ${ti} status=${payload.finalStatus}(AS${answerStatus})`);
  }
}
