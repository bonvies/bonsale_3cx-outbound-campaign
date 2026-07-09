import net from 'net';
import iconv from 'iconv-lite';
import { FiasConn, FiasMessage } from '../types/fias/fiasTypes';
import { setFiasConn } from './fiasConnectionStore';
import { sendLinkStart } from './fiasLinkProtocol';

const STX = '\x02';
const ETX = '\x03';
const FIAS_ENCODING = process.env.FIAS_ENCODING ?? 'utf8';
// 規格「Alive-Check」章節建議主動送 LS 的頻率不超過每 5 分鐘一次
const MIN_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

export type FiasClientConfig = {
  host: string;
  port: number;
  reconnectDelayMs?: number;    // default 5000
  maxReconnectDelayMs?: number; // default 60000
  heartbeatIntervalMs?: number; // default 0（停用），> 0 則定時送 LS 做 alive-check；設定值低於 5 分鐘會被提升到 5 分鐘（規格建議下限）
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
  const configuredHeartbeat = config.heartbeatIntervalMs ?? 0;
  // heartbeatInterval 會被提升到規格建議下限（5 分鐘）或停用（0），避免設定過低造成 PMS 端負擔
  const heartbeatInterval = configuredHeartbeat > 0
    ? Math.max(configuredHeartbeat, MIN_HEARTBEAT_INTERVAL_MS)
    : 0;
  if (configuredHeartbeat > 0 && heartbeatInterval !== configuredHeartbeat) {
    console.warn(
      `[FiasClient] FIAS_HEARTBEAT_INTERVAL_MS=${configuredHeartbeat} 低於規格建議下限，已提升為 ${heartbeatInterval}ms（5 分鐘）`
    );
  }
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
      sendLinkStart(conn);

      // 依規格「Alive-Check」章節：主動確認鏈路存活要送 LS（不是 LA），
      // 且官方建議頻率不超過每 5 分鐘一次（FIAS_HEARTBEAT_INTERVAL_MS 預設值即依此設定）。
      if (heartbeatInterval > 0) {
        heartbeatTimer = setInterval(() => {
          if (conn) sendLinkStart(conn);
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
