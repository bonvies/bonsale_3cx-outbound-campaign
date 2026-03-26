import net from 'net';
import { PmsMessage, PmsConn, PmsHandler } from '../types/pms/pmsTypes';

// ─────────────────────────────────────────────
// Nortel PMS Protocol TCP Server
//
// 訊息格式（來自 NewRock PMSI 文件）：
//   叫醒：SE ST <dn>TI<time><ON/OF>
//   勿擾：SE ST <dn>DN<ON/OF>
//   入退房：SE ET <dn>CH<IN/OF><name><E/F>
//
// TODO: 待取得完整 Nortel PMS 規格文件後補全：
//   - 確認訊息結尾符號（目前假設 \r\n）
//   - 確認 ACK 回應格式
//   - 確認握手/心跳機制是否存在
// ─────────────────────────────────────────────

/**
 * 解析 Nortel PMS 純文字指令
 *
 * 範例輸入：'SE ST 101 TI07:30ON'
 * 範例輸出：{ type: 'SE ST', fields: { dn: '101', TI: '07:30', mode: 'ON' } }
 *
 * TODO: 等拿到規格文件後依實際格式修正
 */
function parseNortelMessage(line: string): PmsMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // TODO: 依實際 Nortel PMS 格式實作解析邏輯
  // 目前僅做基本拆分，讓骨架可以編譯通過
  const parts = trimmed.split(' ');
  if (parts.length < 2) return null;

  // 判斷指令類型（SE ST / SE ET）
  const type = parts.slice(0, 2).join(' '); // 'SE ST' 或 'SE ET'
  const rest = parts.slice(2).join(' ');    // '101 TI07:30ON' 等

  return {
    type,
    fields: { raw: rest }, // TODO: 依規格拆解各欄位
  };
}

/**
 * 建立 Nortel PMS TCP Server
 * 對外介面與 FIAS createServer 一致，均為 (handler) => net.Server
 */
export function createServer(handler: PmsHandler): net.Server {
  return net.createServer((socket) => {
    console.log('--- Nortel PMS 系統已連線 ---');

    socket.setEncoding('ascii');
    console.log(`[連線成功] 來自: ${socket.remoteAddress}:${socket.remotePort}`);

    let buffer = '';

    const conn: PmsConn = {
      send(content: string): void {
        // TODO: 確認 Nortel PMS 回應格式（是否需要特殊結尾）
        console.log(`[發送訊息]: ${content}`);
        socket.write(content + '\r\n');
      },
    };

    socket.on('data', (data: string) => {
      buffer += data;

      // TODO: 確認訊息結尾符號，目前假設 \n 分行
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.substring(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.substring(newlineIndex + 1);

        console.log(`[收到訊息]: ${line}`);

        const msg = parseNortelMessage(line);
        if (msg) {
          handler(msg, conn);
        }
      }
    });

    socket.on('end', () => {
      console.log('--- Nortel PMS 收到客戶端斷開請求 (FIN) ---');
    });

    socket.on('error', (err: Error) => {
      console.log(`--- Nortel PMS 連線發生錯誤: ${err.message} ---`);
    });

    socket.on('close', (hadError: boolean) => {
      console.log(`--- Nortel PMS 連線已關閉 (是否因錯誤: ${hadError}) ---`);
    });
  });
}
