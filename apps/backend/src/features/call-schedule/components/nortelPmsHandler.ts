import { PmsMessage, PmsConn } from '@call-schedule/types/pms/pmsTypes';

// ─────────────────────────────────────────────
// Nortel PMS Protocol Handler
//
// 負責解析並處理來自 PMS 的 Nortel 格式指令。
//
// TODO: 待取得完整規格文件後實作各指令：
//   - SE ST <dn>TI<time><ON/OF>  叫醒預約/取消
//   - SE ST <dn>DN<ON/OF>        勿打擾開關
//   - SE ET <dn>CH<IN/OF>...     入退房
// ─────────────────────────────────────────────

export default async function nortelPmsHandler(msg: PmsMessage, conn: PmsConn): Promise<void> {
  switch (msg.type) {

    case 'SE ST': {
      // TODO: 解析 fields.raw，判斷是 TI（叫醒）還是 DN（勿打擾）
      // 範例：'101 TI07:30ON' → 叫醒 101 分機 07:30
      // 範例：'101 DN ON'     → 勿打擾開啟
      console.log('[NortelPMS] SE ST 指令（TODO）:', msg.fields.raw);

      // TODO: 實作叫醒/勿打擾邏輯，呼叫 createCallSchedule / deleteCallSchedule
      // TODO: 確認 ACK 格式並回應
      conn.send('ACK');
      break;
    }

    case 'SE ET': {
      // TODO: 解析 fields.raw，處理 Check-in / Check-out
      // 範例：'125 CH IN WM E4' → 125 分機 Check-in
      console.log('[NortelPMS] SE ET 指令（TODO）:', msg.fields.raw);

      // TODO: 實作入退房邏輯
      conn.send('ACK');
      break;
    }

    default:
      console.warn(`[NortelPMS] 未知指令類型: ${msg.type}`, msg.fields);
  }
}
