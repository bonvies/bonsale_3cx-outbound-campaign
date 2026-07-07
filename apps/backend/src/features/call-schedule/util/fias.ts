import net from 'net';
import iconv from 'iconv-lite';
import { FiasConn, FiasMessage } from '../types/fias/fiasTypes';
// FIAS 協定使用這兩個特殊 byte 包住每則訊息，作為「信封」
// STX (Start of Text) = byte 0x02，標記訊息開頭
// ETX (End of Text)   = byte 0x03，標記訊息結尾
// 完整訊息格式：\x02TYPE|FIELD1VALUE1|FIELD2VALUE2\x03
const STX = '\x02';
const ETX = '\x03';
const FIAS_ENCODING = process.env.FIAS_ENCODING ?? 'utf8';

export type FiasHandler = (msg: FiasMessage, conn: FiasConn) => void;

// 將 pipe 分割後的欄位陣列轉為 key/value 物件
// FIAS 欄位格式：前 2 個字元是 key，後面全是 value
// 範例輸入：['WR', 'RN101', 'TI0730']
// 範例輸出：{ RN: '101', TI: '0730' }
function parseFiasFields(fields: string[]): Record<string, string> {
    const obj: Record<string, string> = {};
    // slice(1) 跳過第一個元素（訊息類型 'WR'、'LS' 等），從欄位開始處理
    fields.slice(1).forEach(f => {
        const key = f.substring(0, 2); // 前 2 字元是 key，例如 'RN'
        const value = f.substring(2);  // 第 3 字元之後是 value，例如 '101'
        obj[key] = value;
    });
    return obj;
}

// 建立 FIAS TCP server，對外隱藏 STX/ETX framing 與 buffer 細節
// handler: 使用者定義的訊息處理函式，簽名為 (msg, conn) => {}
//   msg  = { type: 'WR', fields: { RN: '101', TI: '0730' } }
//   conn = { send(content) }  發送回應用
export function createServer(handler: FiasHandler, onClose?: () => void): net.Server {
    return net.createServer((socket) => {
        console.log('--- PMS 系統已連線 ---');

        console.log(`[連線成功] 來自: ${socket.remoteAddress}:${socket.remotePort}`);

        // TCP 是串流協定，不保證一次 data 事件就能收到完整訊息
        // 用 binaryBuffer 把每次收到的片段累積起來，等出現完整的 STX...ETX 再處理
        let binaryBuffer = '';

        // conn 物件：封裝發送邏輯，讓使用者只需 conn.send('LA')
        // 實際送出的內容會自動加上 STX 和 ETX：\x02LA\x03
        const conn: FiasConn = {
            send(content: string): void {
                console.log(`[發送訊息]: ${content}`);
                const encoded = iconv.encode(content, FIAS_ENCODING);
                const frame = STX + encoded.toString('binary') + ETX;
                socket.write(frame, 'binary');
            }
        };

        socket.on('data', (data: Buffer) => {
            binaryBuffer += data.toString('binary');

            // 用 while 而非 if：同一次 data 可能包含多則訊息（例如 LA 和 WR 同時到）
            // 只要 binaryBuffer 裡還有完整的 STX...ETX，就繼續解析
            while (binaryBuffer.includes(STX) && binaryBuffer.includes(ETX)) {
                const start = binaryBuffer.indexOf(STX);
                const end = binaryBuffer.indexOf(ETX);

                // 防禦性處理：若 ETX 出現在 STX 之前，代表資料損毀或殘留垃圾
                // 把這個孤立的 ETX 丟掉，重新找下一組有效訊框
                if (start > end) {
                    binaryBuffer = binaryBuffer.substring(end + 1);
                    continue;
                }

                const messageBytes = Buffer.from(binaryBuffer.substring(start + 1, end), 'binary');
                const rawMessage = iconv.decode(messageBytes, FIAS_ENCODING);
                console.log(`[收到原始訊息]: ${rawMessage}`);

                // 把已處理的部分從 binaryBuffer 移除，保留 ETX 之後的剩餘資料
                binaryBuffer = binaryBuffer.substring(end + 1);

                // 以 '|' 切割，第一段是訊息類型，其餘是欄位
                // 例如：['WR', 'RN101', 'TI0730']
                const fields = rawMessage.split('|');
                const msg: FiasMessage = {
                    type: fields[0],                  // 'WR'
                    fields: parseFiasFields(fields)   // { RN: '101', TI: '0730' }
                };

                // 將解析好的訊息與發送工具交給使用者的 handler
                handler(msg, conn);
            }
        });

        // 對方發起斷線（送出 TCP FIN）
        socket.on('end', () => {
            console.log('--- 收到客戶端斷開請求 (FIN) ---');
        });

        // 連線過程中發生錯誤（例如網路中斷）
        socket.on('error', (err: Error) => {
            console.log(`--- 連線發生錯誤: ${err.message} ---`);
        });

        // 連線完全關閉（end 或 error 之後都會觸發）
        // hadError 為 true 表示因錯誤關閉，false 表示正常關閉
        socket.on('close', (hadError: boolean) => {
            console.log(`--- 連線已徹底關閉 (是否因為錯誤: ${hadError}) ---`);
            onClose?.();
        });
    });
}
