import net from 'net';
import iconv from 'iconv-lite';
import { FiasConn, FiasMessage } from '../types/fias/fiasTypes';
import { setFiasConn } from './fiasConnectionStore';

const STX = '\x02';
const ETX = '\x03';
const FIAS_ENCODING = process.env.FIAS_ENCODING ?? 'utf8';

export type FiasClientConfig = {
  host: string;
  port: number;
  reconnectDelayMs?: number;    // default 5000
  maxReconnectDelayMs?: number; // default 60000
  heartbeatIntervalMs?: number; // default 0（停用），> 0 則定時送 LA
};

export type FiasClientHandler = (msg: FiasMessage, conn: FiasConn) => void | Promise<void>;

function parseFiasFields(fields: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  fields.slice(1).forEach(f => {
    const key = f.substring(0, 2);
    const value = f.substring(2);
    obj[key] = value;
  });
  return obj;
}

function buildLsMessage(): string {
  const now = new Date();
  const da = now.toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD
  const ti = now.toISOString().slice(11, 19).replace(/:/g, ''); // HHMMSS
  return `LS|DA${da}|TI${ti}`;
}

/**
 * 以 TCP client 身份主動連線至 PMS（PMS SERVER 模式）。
 *
 * 與 fias.ts createServer 相對，此函式用於 PMS 本身是 TCP server 的場景：
 *   1. 連線成功後立即送出 LS 握手
 *   2. 所有解析出的訊息（含 LS/LE/LA/WR/...）一律轉交 handler 處理，
 *      LS/LE 的握手回覆邏輯統一交由 fiasHandler.ts 呼叫 fiasLinkProtocol.ts
 *      的共用函式，跟 fias.ts（server 模式）共用同一套規則，不在這裡重複攔截
 *   3. 斷線後自動重連（指數退避）
 */
export function connectToPms(
  config: FiasClientConfig,
  handler: FiasClientHandler,
  onClose?: () => void,
): void {
  const baseDelay = config.reconnectDelayMs ?? 5000;
  const maxDelay = config.maxReconnectDelayMs ?? 60000;
  const heartbeatInterval = config.heartbeatIntervalMs ?? 0;
  let currentDelay = baseDelay;

  function connect(): void {
    const socket = net.connect(config.port, config.host);
    let binaryBuffer = '';
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let conn: FiasConn | null = null;

    socket.on('connect', () => {
      console.log(`[FiasClient] 已連線至 PMS ${config.host}:${config.port}`);
      currentDelay = baseDelay; // 連線成功後重置退避

      conn = {
        send(content: string): void {
          console.log(`[FiasClient] 發送訊息: ${content}`);
          const encoded = iconv.encode(content, FIAS_ENCODING);
          const frame = STX + encoded.toString('binary') + ETX;
          socket.write(frame, 'binary');
        },
      };

      setFiasConn(conn);
      conn.send(buildLsMessage());

      if (heartbeatInterval > 0) {
        heartbeatTimer = setInterval(() => {
          conn?.send('LA');
        }, heartbeatInterval);
      }
    });

    socket.on('data', (data: Buffer) => {


      // TEMP DEBUG：排查 check-in(GI) 收不到訊號問題，測完拿掉
      console.log(`[FiasClient] 收到原始 Buffer (${data.length} bytes):`, data.toString('binary'));


      binaryBuffer += data.toString('binary');

      while (binaryBuffer.includes(STX) && binaryBuffer.includes(ETX)) {
        const start = binaryBuffer.indexOf(STX);
        const end = binaryBuffer.indexOf(ETX);

        if (start > end) {
          binaryBuffer = binaryBuffer.substring(end + 1);
          continue;
        }

        const messageBytes = Buffer.from(binaryBuffer.substring(start + 1, end), 'binary');
        const rawMessage = iconv.decode(messageBytes, FIAS_ENCODING);
        console.log(`[FiasClient] 收到原始訊息: ${rawMessage}`);
        binaryBuffer = binaryBuffer.substring(end + 1);

        const fields = rawMessage.split('|');
        const msg: FiasMessage = {
          type: fields[0],
          fields: parseFiasFields(fields),
        };

        // LS/LE 的握手回覆邏輯已移至 fiasHandler.ts（呼叫 fiasLinkProtocol.ts 共用函式），
        // 這裡不再攔截，跟其他訊息類型一樣一律轉交 handler
        void handler(msg, conn!);
      }
    });

    socket.on('error', (err: Error) => {
      console.error(`[FiasClient] 連線錯誤: ${err.message}`);
    });

    socket.on('close', () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      setFiasConn(null);
      onClose?.();

      console.log(`[FiasClient] 連線已關閉，${currentDelay}ms 後重連...`);
      setTimeout(() => {
        currentDelay = Math.min(currentDelay * 2, maxDelay);
        connect();
      }, currentDelay);
    });
  }

  connect();
}
