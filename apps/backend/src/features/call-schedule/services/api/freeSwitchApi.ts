import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { ApiResult } from '../callService/phoneApiService';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_API_URL = 'http://127.0.0.1:5002';
const DEFAULT_API_KEY = 'Bonvies42633506';

export const API_URL = process.env.FREESWITCH_API_URL ?? DEFAULT_API_URL;
const API_KEY = process.env.FREESWITCH_API_KEY ?? DEFAULT_API_KEY;
// FusionPBX 的 SIP domain（Cloud Run 外層 API 依 domain 查 active_ip 轉送到對應 FS 主機），
// 與 FIAS Middleware（freeSwitchPmsApi）指向同一套 FusionPBX，共用同一個環境變數
const DOMAIN = `${process.env.FREESWITCH_PMS_DOMAIN_NAME}`;
const HEADERS = {
  'Content-Type': 'application/json',
  'X-API-KEY': API_KEY,
};

/**
 * 通話結果回呼網址：middleware 撥號結束後會 POST callback payload（profile=call_result）到這裡。
 * FREESWITCH_CALLBACK_BASE_URL 需為本服務的對外可達網址（例如 Cloud Run 網址），
 * 本地開發要收回呼需搭配 ngrok 等通道。未設定時不帶 callback_url（收不到結果、重試機制失效）。
 */
function buildCallbackUrl(): string | undefined {
  const base = process.env.FREESWITCH_CALLBACK_BASE_URL;
  if (!base) return undefined;
  return `${base.replace(/\/$/, '')}/api/call-schedule/freeswitch-webhook`;
}

// /make_morning_call 與 /make_call 為非同步模式：API 先回 accepted/queued，
// 實際通話結果由 callback_url 回呼（見 FreeSwitchCallMonitorService）
type AsyncCallResponse = {
  status: 'accepted' | 'success' | 'failed' | 'error' | string;
  result?: string;           // e.g. 'queued'
  profile?: string;          // 'call_result'
  purpose?: string;          // 'morning_call' | 'make_call'
  request_id?: string;
  callback_enabled?: boolean;
  error_detail?: string;
  message?: string;
};

// 健康檢查
export async function healthCheck(): Promise<ApiResult<{ status: string }>> {
  try {
    const response = await axios.get<{ status: string }>(`${API_URL}/health`, { headers: HEADERS });
    return { success: true, data: response.data };
  } catch (err) {
    console.error('[freeSwitchApi] healthCheck 失敗:', err);
    return { success: false, error: err };
  }
}

/**
 * 撥打叫醒電話（非同步：回應 accepted 只代表已排入佇列，結果經 callback 回報）。
 *
 * 已實測確認：middleware 對 morning call 是「系統直接對房間播放語音」，
 * 不是兩個分機真的互打，CDR 裡 caller/callee 一律是 room_number 本身，
 * from（caller_id）欄位會被忽略、不影響實際行為，僅為相容 request 格式而送。
 * OM_CALL_FROM_EXTENSION 對 FreeSwitch 來說因此沒有實質作用，
 * 真的需要指定主叫方時應改用 makeCall()。
 */
export async function makeMorningCall(from: string, to: string): Promise<ApiResult<unknown>> {
  const requestId = randomUUID();
  const callbackUrl = buildCallbackUrl();
  if (!callbackUrl) {
    console.warn('[freeSwitchApi] 未設定 FREESWITCH_CALLBACK_BASE_URL，將收不到通話結果回呼（接聽判定與重試機制失效）');
  }

  try {
    const response = await axios.post<AsyncCallResponse>(`${API_URL}/make_morning_call`, {
      domain: DOMAIN,
      room_number: to,
      caller_id: from,
      caller_id_name: 'MorningCall',
      request_id: requestId,
      ...(callbackUrl && { callback_url: callbackUrl }),
    }, { headers: HEADERS });

    const json = response.data;
    console.log(`[freeSwitchApi] makeMorningCall(${from} → ${to}) HTTP ${response.status} request_id=${requestId}`, json);

    // 舊版同步模式回 success，新版非同步模式回 accepted，兩者皆視為撥號請求成功
    if (json.status === 'accepted' || json.status === 'success') {
      return { success: true, data: json };
    }
    return { success: false, error: json.error_detail ?? json.message ?? json };
  } catch (err) {
    console.error(`[freeSwitchApi] makeMorningCall(${from} → ${to}) 失敗:`, err);
    return { success: false, error: err };
  }
}

/**
 * 一般撥號（BonUC 文件 5. 一般 Make Call API），非同步模式，回應 accepted 只代表已排入佇列。
 * 目前尚未接到任何 route/service，備用（例如未來需要真的兩個分機互打的情境）。
 * 跟 makeMorningCall 的差異：request 欄位是 number（不是 room_number），
 * 且 caller_id 對 middleware 來說是真的會被採用的主叫方。
 */
export async function makeCall(from: string, to: string, callerIdName = 'API Call'): Promise<ApiResult<unknown>> {
  const requestId = randomUUID();
  const callbackUrl = buildCallbackUrl();
  if (!callbackUrl) {
    console.warn('[freeSwitchApi] 未設定 FREESWITCH_CALLBACK_BASE_URL，將收不到通話結果回呼（接聽判定與重試機制失效）');
  }

  try {
    const response = await axios.post<AsyncCallResponse>(`${API_URL}/make_call`, {
      domain: DOMAIN,
      number: to,
      caller_id: from,
      caller_id_name: callerIdName,
      request_id: requestId,
      ...(callbackUrl && { callback_url: callbackUrl }),
    }, { headers: HEADERS });

    const json = response.data;
    console.log(`[freeSwitchApi] makeCall(${from} → ${to}) HTTP ${response.status} request_id=${requestId}`, json);

    if (json.status === 'accepted' || json.status === 'success') {
      return { success: true, data: json };
    }
    return { success: false, error: json.error_detail ?? json.message ?? json };
  } catch (err) {
    console.error(`[freeSwitchApi] makeCall(${from} → ${to}) 失敗:`, err);
    return { success: false, error: err };
  }
}
