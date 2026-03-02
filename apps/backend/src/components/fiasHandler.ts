import { FiasConn, FiasMessage } from '../types/fias/fiasTypes';

export default function fiasHandler(msg: FiasMessage, conn: FiasConn): void {
  // 根據訊息類型執行不同邏輯
  switch (msg.type) {
    case 'WR':
      // 例如：收到 WR 訊息，回應 LA
      conn.send('LA');
      break;
    case 'XX':
      // 處理其他類型的訊息
      break;
    default:
      console.warn(`[未知訊息類型]: ${msg.type}`);
  }
}