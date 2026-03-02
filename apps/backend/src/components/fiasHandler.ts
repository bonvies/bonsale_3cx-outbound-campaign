import { FiasConn, FiasMessage } from '@/types/fias/fiasTypes';
import { mackeCall } from '@/services/api/newRockApi';

export default async function fiasHandler(msg: FiasMessage, conn: FiasConn): Promise<void> {
  // 根據訊息類型執行不同邏輯
  switch (msg.type) {
    case 'LS':
      console.log('執行握手程序...');
      conn.send('LS|DA260226|TI120000');
      break;

    case 'LA':
      conn.send('LA');
      break;

    case 'WR':
      console.log(`收到預約：房間 ${msg.fields.RN}，時間 ${msg.fields.TI}`);
      // TODO: 在這裡把資料存入你的 bonsale 資料庫
      console.log(`TODO 已將預約資訊存入資料庫：RN=${msg.fields.RN}, TI=${msg.fields.TI}`);

      // 呼叫 API 撥打電話
      // TODO : 這裡直接呼叫 mackeCall() 是為了測試，實際上你應該把它包在一個服務函式裡，並傳入必要參數（例如房間號碼）來撥打對應的電話
      const toCall = await mackeCall('9038', '9037'); 
      console.log('撥打電話結果:', toCall);

      conn.send(`WC|RN${msg.fields.RN}|ST1`);
      break;
    default:
      console.warn(`[未知訊息類型]: ${msg.type}`);
  }
}