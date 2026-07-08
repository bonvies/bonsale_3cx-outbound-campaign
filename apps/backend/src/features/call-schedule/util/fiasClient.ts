import net from 'net';
import iconv from 'iconv-lite';
import { FiasConn, FiasMessage } from '../types/fias/fiasTypes';
import { setFiasConn } from './fiasConnectionStore';

const STX = '\x02';
const ETX = '\x03';
const FIAS_ENCODING = process.env.FIAS_ENCODING ?? 'utf8';
const FIAS_VENDOR_VERSION = process.env.FIAS_VENDOR_VERSION ?? '1.0';
const FIAS_INTERFACE_FAMILY = process.env.FIAS_INTERFACE_FAMILY ?? 'PB'; // PBX，見規格 Interface Type Table

// 依 Oracle Hospitality IFC8 FIAS Interface Specs「LD - Link Description, LR - Link Record」：
// 收到 PMS 的 LS 後，必須完整送出 LD + 每種會用到的記錄類型各一筆 LR + LA，
// PMS 才會脫離「未定義」狀態、開始真正收送資料記錄（LA 心跳不受影響，所以缺這段時
// 心跳仍會正常跳動，但業務記錄會被 PMS 單向忽略——這正是「除了 LA 都收不到」的成因）。
// From PMS 方向的類型（GI/GO/GC/RE/PA/WR/WC）欄位盡量宣告「規格 Appendix C - Field ID
// 附錄裡該類型允許的全部欄位」，不只挑我方 fiasHandler.ts 目前會讀的那幾個——
// 目的是先把客戶 PMS 實際上會送什麼「看到」，避免自己猜欄位、漏看真實資料
//（例如先前遇到的 GC 大包欄位、CI/GI 搞混，都是同一類「猜錯格式」的問題）。
// PS 是我方主動送出去的類型，欄位由我方自己組裝決定，不受這個「盡量多接收」的考量影響。
//
// WR/WD 是照 docs/FIAS_INTEGRATION.md 過去記錄的行為（用 DT、RI、MR），但這些**不是**
// 官方規格欄位代碼——規格正式的叫醒記錄其實是 WR/WC/WA（日期欄位是 DA 不是 DT，
// 也沒有 RI/MR），可能是這台 PMS 的客製化欄位，也可能當初記錄的就是錯的、只是還沒
// 被戳破。這裡把「規格版」跟「目前假設版」都宣告進去，兩邊都不要漏接；WC/WA 的部分
// 之後要不要照規格重新核對，之後再回頭處理。
const LINK_RECORDS: { ri: string; fields: string }[] = [
  { ri: 'WR', fields: 'RNDADTTIRIMR' },  // 叫醒預約（From PMS，官方 DA + 目前假設的 DT/RI/MR 都宣告）
  { ri: 'WD', fields: 'RNDADTTI' },      // 取消叫醒（From PMS，非官方代碼，見上方說明）
  { ri: 'WC', fields: 'RNDATI' },        // 取消叫醒（官方代碼，以防 PMS 實際用這個而非 WD）
  { ri: 'GI', fields: 'RNG#GNCSDATIGAGDGFGGGLGSGTGVMRNPSFTVVRG+' }, // Check-in（From PMS，全部欄位）
  { ri: 'GO', fields: 'RNG#GSDASFTI' },  // Check-out（From PMS，全部欄位）
  { ri: 'GC', fields: 'RNG#ROGNCSDATIGAGDGFGGGLGSGTGVMRNPTVVRG+' }, // 資料異動／換房（From PMS，全部欄位）
  { ri: 'RE', fields: 'RNCSCTDNG#IDMLMRPPPURSTVVM' }, // DND（From PMS）／房況（To PMS），全部欄位
  { ri: 'PS', fields: 'RNDATIPTDDDUMPTAP#PCCTSO' },   // 電話計費（To PMS，我方自己組裝，維持現狀）
  { ri: 'PA', fields: 'RNASP#DATIGNIDSOWSC#' },        // 計費回覆（From PMS，全部欄位）
];

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
  console.log(`[FiasClient] 送出 LS 握手: DA=${da} TI=${ti}`);
  return `LS|DA${da}|TI${ti}`;
}

function buildLdMessage(): string {
  const now = new Date();
  const da = now.toISOString().slice(2, 10).replace(/-/g, '');
  const ti = now.toISOString().slice(11, 19).replace(/:/g, '');
  console.log(`[FiasClient] 送出 LD 握手: DA=${da} TI=${ti}`);
  return `LD|DA${da}|TI${ti}|V#${FIAS_VENDOR_VERSION}|IF${FIAS_INTERFACE_FAMILY}|`;
}

function buildLrMessages(): string[] {
  console.log('[FiasClient] 送出 LR 握手序列:');
  return LINK_RECORDS.map(({ ri, fields }) => {
    console.log(`  - LR|RI${ri}|FL${fields}|`);
    return `LR|RI${ri}|FL${fields}|`;
  });
}

function buildLaMessage(): string {
  const now = new Date();
  const da = now.toISOString().slice(2, 10).replace(/-/g, '');
  const ti = now.toISOString().slice(11, 19).replace(/:/g, '');
  console.log(`[FiasClient] 送出 LA 握手: DA=${da} TI=${ti}`);
  return `LA|DA${da}|TI${ti}|`;
}

// 收到 PMS 的 LS 後送出完整 LD + LR(每種記錄類型) + LA 握手序列，
// PMS 才會脫離未定義狀態、開始真正處理資料記錄（見上方 LINK_RECORDS 說明）
function sendLinkHandshake(conn: FiasConn): void {
  console.log('[FiasClient] 收到 PMS LS，送出 LD/LR/LA 握手序列...');
  conn.send(buildLdMessage());
  buildLrMessages().forEach(lr => conn.send(lr));
  conn.send(buildLaMessage());
  console.log('[FiasClient] LD/LR/LA 已送出，連線應已進入 LinkAlive 狀態');
}

function buildLeMessage(): string {
  const now = new Date();
  const da = now.toISOString().slice(2, 10).replace(/-/g, '');
  const ti = now.toISOString().slice(11, 19).replace(/:/g, '');
  return `LE|DA${da}|TI${ti}|`;
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

        // 收到 PMS 的 LS：不轉交 handler（避免循環回送），改送 LD/LR/LA 握手序列
        if (msg.type === 'LS') {
          sendLinkHandshake(conn!);
          continue;
        }

        // 收到 PMS 的 LE（PMS 介面即將關閉）：依規格「External system to reply with LE」
        // 回送一筆 LE 確認，不轉交 handler。之後 socket 的 close 事件會觸發既有重連邏輯。
        if (msg.type === 'LE') {
          console.log('[FiasClient] 收到 PMS LE，回送 LE 確認連線結束');
          conn!.send(buildLeMessage());
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
