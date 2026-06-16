import { ICallResultHandler, CallResultPayload } from '../services/monitor/callResultNotifier';
import { getFiasConn } from '../util/fiasConnectionStore';

export class LakeshoreCallResultHandler implements ICallResultHandler {
  handle(payload: CallResultPayload): void {
    const conn = getFiasConn();
    if (!conn) {
      console.warn('[Lakeshore] FIAS conn 不存在，無法回傳通話結果');
      return;
    }

    const prefix = process.env.FIAS_EXTENSION_PREFIX ?? '';
    const roomNum = prefix && payload.extension.startsWith(prefix)
      ? payload.extension.slice(prefix.length)
      : payload.extension;

    // WA / WN 為標準 FIAS 叫醒結果訊息；若客戶格式不同，只改這兩行
    if (payload.finalStatus === 'ANSWERED') {
      conn.send(`WA|RN${roomNum}`);
    } else {
      conn.send(`WN|RN${roomNum}`);
    }

    console.log(`[Lakeshore] FIAS 結果回傳：status=${payload.finalStatus} room=${roomNum}`);
  }
}
