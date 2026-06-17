import net from 'net';
import { FiasConn, FiasMessage } from '../types/fias/fiasTypes';
import { setFiasConn } from './fiasConnectionStore';

const STX = '\x02';
const ETX = '\x03';

export type FiasClientConfig = {
  host: string;
  port: number;
  reconnectDelayMs?: number;    // default 5000
  maxReconnectDelayMs?: number; // default 60000
  heartbeatIntervalMs?: number; // default 30000，0 = 停用
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
 *   2. 收到 PMS 回傳的 LS 視為握手完成（不再回送 LS，避免循環）
 *   3. WR / WD / LA 等訊息轉交 handler 處理
 *   4. 斷線後自動重連（指數退避）
 */
export function connectToPms(
  config: FiasClientConfig,
  handler: FiasClientHandler,
  onClose?: () => void,
): void {
  const baseDelay = config.reconnectDelayMs ?? 5000;
  const maxDelay = config.maxReconnectDelayMs ?? 60000;
  const heartbeatInterval = config.heartbeatIntervalMs ?? 30000;
  let currentDelay = baseDelay;

  function connect(): void {
    const socket = net.connect(config.port, config.host);
    socket.setEncoding('ascii');

    let buffer = '';
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let conn: FiasConn | null = null;

    socket.on('connect', () => {
      console.log(`[FiasClient] 已連線至 PMS ${config.host}:${config.port}`);
      currentDelay = baseDelay; // 連線成功後重置退避

      conn = {
        send(content: string): void {
          console.log(`[FiasClient] 發送訊息: ${content}`);
          socket.write(STX + content + ETX);
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

    socket.on('data', (data: string) => {
      console.log(`[FiasClient] 收到原始 Buffer:`, data);
      buffer += data;

      while (buffer.includes(STX) && buffer.includes(ETX)) {
        const start = buffer.indexOf(STX);
        const end = buffer.indexOf(ETX);

        if (start > end) {
          buffer = buffer.substring(end + 1);
          continue;
        }

        const rawMessage = buffer.substring(start + 1, end);
        console.log(`[FiasClient] 收到原始訊息: ${rawMessage}`);
        buffer = buffer.substring(end + 1);

        const fields = rawMessage.split('|');
        const msg: FiasMessage = {
          type: fields[0],
          fields: parseFiasFields(fields),
        };

        // PMS 回傳 LS = 握手確認，不轉交 handler（避免循環回送）
        if (msg.type === 'LS') {
          console.log('[FiasClient] PMS 握手完成 (LS 已確認)');
          continue;
        }

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
