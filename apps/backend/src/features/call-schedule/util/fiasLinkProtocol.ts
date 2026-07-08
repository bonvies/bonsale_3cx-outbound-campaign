import { FiasConn } from '../types/fias/fiasTypes';

const FIAS_VENDOR_VERSION = process.env.FIAS_VENDOR_VERSION ?? '1.0';
const FIAS_INTERFACE_FAMILY = process.env.FIAS_INTERFACE_FAMILY ?? 'PB'; // PBX，見規格 Interface Type Table

// 依 Oracle Hospitality IFC8 FIAS Interface Specs「LD - Link Description, LR - Link Record」：
// 收到 PMS 的 LS 後，必須完整送出 LD + 每種會用到的記錄類型各一筆 LR + LA，
// PMS 才會脫離「未定義」狀態、開始真正收送資料記錄（LA 心跳不受影響，所以缺這段時
// 心跳仍會正常跳動，但業務記錄會被 PMS 單向忽略——這正是「除了 LA 都收不到」的成因）。
// 這套規則跟我方是 TCP client（fiasClient.ts，PMS 為 server）或 TCP server
//（fias.ts，PMS 為 client）無關，兩種連線模式都要遵守，所以獨立成這個共用檔案。
//
// From PMS 方向的類型（GI/GO/GC/RE/PA/WR/WC）欄位盡量宣告「規格 Appendix C - Field ID
// 附錄裡該類型允許的全部欄位」，不只挑我方 fiasHandler.ts 目前會讀的那幾個——
// 目的是先把客戶 PMS 實際上會送什麼「看到」，避免自己猜欄位、漏看真實資料
//（例如先前遇到的 GC 大包欄位、CI/GI 搞混，都是同一類「猜錯格式」的問題）。
// PS 是我方主動送出去的類型，欄位由我方自己組裝決定，不受這個「盡量多接收」的考量影響。
//
// WR 的 DT/RI/MR 是照 docs/FIAS_INTEGRATION.md 過去記錄的行為，但這些**不是**官方
// 規格欄位代碼——規格正式的叫醒記錄是 WR/WC/WA（日期欄位是 DA 不是 DT，也沒有
// RI/MR），可能是這台 PMS 的客製化欄位，也可能當初記錄的就是錯的、只是還沒被
// 戳破，所以 DA/DT 都宣告、都不漏接。取消叫醒原本用的 WD 確定不是官方代碼、也
// 找不到任何文件根據，已直接移除，只保留規格正式代碼 WC。
const LINK_RECORDS: { ri: string; fields: string }[] = [
  { ri: 'WR', fields: 'RNDADTTIRIMR' },  // 叫醒預約（From PMS，官方 DA + 目前假設的 DT/RI/MR 都宣告）
  { ri: 'WC', fields: 'RNDADTTI' },      // 取消叫醒（官方代碼，DT 為過去假設欄位一併宣告）
  { ri: 'WA', fields: 'RNDATIAS' },      // 叫醒結果回報（To PMS，fiasWakeupResultHandler.ts 送出）
  { ri: 'GI', fields: 'RNG#GNCSDATIGAGDGFGGGLGSGTGVMRNPSFTVVRG+' }, // Check-in（From PMS，全部欄位）
  { ri: 'GO', fields: 'RNG#GSDASFTI' },  // Check-out（From PMS，全部欄位）
  { ri: 'GC', fields: 'RNG#ROGNCSDATIGAGDGFGGGLGSGTGVMRNPTVVRG+' }, // 資料異動／換房（From PMS，全部欄位）
  { ri: 'RE', fields: 'RNCSCTDNG#IDMLMRPPPURSTVVM' }, // DND（From PMS）／房況（To PMS），全部欄位
  { ri: 'PS', fields: 'RNDATIPTDDDUMPTAP#PCCTSO' },   // 電話計費（To PMS，我方自己組裝，維持現狀）
  { ri: 'PA', fields: 'RNASP#DATIGNIDSOWSC#' },        // 計費回覆（From PMS，全部欄位）
];

function buildLdMessage(): string {
  const now = new Date();
  const da = now.toISOString().slice(2, 10).replace(/-/g, '');
  const ti = now.toISOString().slice(11, 19).replace(/:/g, '');
  return `LD|DA${da}|TI${ti}|V#${FIAS_VENDOR_VERSION}|IF${FIAS_INTERFACE_FAMILY}|`;
}

function buildLrMessages(): string[] {
  return LINK_RECORDS.map(({ ri, fields }) => `LR|RI${ri}|FL${fields}|`);
}

function buildLaMessage(): string {
  const now = new Date();
  const da = now.toISOString().slice(2, 10).replace(/-/g, '');
  const ti = now.toISOString().slice(11, 19).replace(/:/g, '');
  return `LA|DA${da}|TI${ti}|`;
}

function buildLeMessage(): string {
  const now = new Date();
  const da = now.toISOString().slice(2, 10).replace(/-/g, '');
  const ti = now.toISOString().slice(11, 19).replace(/:/g, '');
  return `LE|DA${da}|TI${ti}|`;
}

/**
 * 收到 PMS 的 LS 後送出完整 LD + LR(每種記錄類型) + LA 握手序列，
 * PMS 才會脫離未定義狀態、開始真正處理資料記錄（見上方 LINK_RECORDS 說明）。
 * client（fiasClient.ts）、server（fias.ts 透過 fiasHandler.ts）兩種模式共用。
 */
export function sendLinkHandshake(conn: FiasConn): void {
  console.log('[FiasProtocol] 收到 PMS LS，送出 LD/LR/LA 握手序列...');
  conn.send(buildLdMessage());
  buildLrMessages().forEach(lr => conn.send(lr));
  conn.send(buildLaMessage());
  console.log('[FiasProtocol] LD/LR/LA 已送出，連線應已進入 LinkAlive 狀態');
}

/**
 * 收到 PMS 的 LE（介面即將關閉）後回覆一筆 LE 確認，依規格
 * 「External system to reply with LE」。client/server 兩種模式共用。
 */
export function sendLinkEnd(conn: FiasConn): void {
  console.log('[FiasProtocol] 收到 PMS LE，回送 LE 確認連線結束');
  conn.send(buildLeMessage());
}

/**
 * 收到 PMS 的 LA（心跳）後回覆一筆 LA，維持連線存活狀態。
 * client/server 兩種模式共用。
 */
export function sendLinkAlive(conn: FiasConn): void {
  conn.send(buildLaMessage());
}
