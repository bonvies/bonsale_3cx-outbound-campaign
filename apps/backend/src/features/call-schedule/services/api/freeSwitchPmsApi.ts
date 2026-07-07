import axios from 'axios';
import { ApiResult } from '../callService/phoneApiService';
import dotenv from 'dotenv';

dotenv.config();

// FIAS Middleware（cdr-webhook），負責 check-in/check-out 時更新 FusionPBX 分機的
// toll_allow 與 caller ID。跟 freeSwitchApi.ts 打的 py-dialer 是完全不同的服務
// （不同 port、不同 X-API-KEY 值），欄位/認證方式已依主管實測結果確認。
const DEFAULT_API_URL = 'http://127.0.0.1:5001';

const API_URL = `${process.env.FREESWITCH_PMS_API_URL ?? DEFAULT_API_URL}`;
const DOMAIN_NAME = `${process.env.FREESWITCH_PMS_DOMAIN_NAME}`;
const HEADERS = {
  'Content-Type': 'application/json',
  'X-API-KEY': `${process.env.FREESWITCH_PMS_API_KEY}`,
};

// PMS COS 權限等級（見《整合說明書》4.1）：CS0 只允許 Internal/Emergency/Service/TollFree，
// CS1 = CS0+Local，CS2 = CS1+National+Mobile，CS3 = 全部允許（含 International）
export type TollAllow = 'CS0' | 'CS1' | 'CS2' | 'CS3';

// 《整合說明書》5.1-5.3 未列出回應 body 格式，暫以寬鬆型別接收
type PmsExtensionResponse = Record<string, unknown>;

/**
 * 客人入住：更新 FusionPBX 分機的通話權限（toll_allow）與顯示名稱，見《整合說明書》5.1。
 */
export async function checkin(roomNumber: string, guestName: string, tollAllow: TollAllow): Promise<ApiResult<PmsExtensionResponse>> {
  try {
    const response = await axios.post<PmsExtensionResponse>(`${API_URL}/pms/extension/checkin`, {
      domain_name: DOMAIN_NAME,
      room_number: roomNumber,
      guest_name: guestName,
      toll_allow: tollAllow,
      reloadxml: true,
    }, { headers: HEADERS });
    console.log(`[freeSwitchPmsApi] checkin(房號=${roomNumber}) HTTP ${response.status}`, response.data);
    return { success: true, data: response.data };
  } catch (err) {
    console.error(`[freeSwitchPmsApi] checkin(房號=${roomNumber}) 失敗:`, err);
    return { success: false, error: err };
  }
}

/**
 * 客人退房：將 FusionPBX 分機的通話權限與顯示名稱還原為預設狀態，見《整合說明書》5.2。
 */
export async function checkout(roomNumber: string): Promise<ApiResult<PmsExtensionResponse>> {
  try {
    const response = await axios.post<PmsExtensionResponse>(`${API_URL}/pms/extension/checkout`, {
      domain_name: DOMAIN_NAME,
      room_number: roomNumber,
      reloadxml: true,
    }, { headers: HEADERS });
    console.log(`[freeSwitchPmsApi] checkout(房號=${roomNumber}) HTTP ${response.status}`, response.data);
    return { success: true, data: response.data };
  } catch (err) {
    console.error(`[freeSwitchPmsApi] checkout(房號=${roomNumber}) 失敗:`, err);
    return { success: false, error: err };
  }
}

/**
 * 直接指定欄位更新分機（不經過 checkin/checkout 的自動規則），見《整合說明書》5.3。
 * toll_allow、effectiveCallerIdName 主管建議必填，effectiveCallerIdNumber 依需要帶入。
 */
export async function update(params: {
  extension: string;
  tollAllow?: TollAllow;
  effectiveCallerIdName?: string;
  effectiveCallerIdNumber?: string;
}): Promise<ApiResult<PmsExtensionResponse>> {
  const { extension, tollAllow, effectiveCallerIdName, effectiveCallerIdNumber } = params;
  try {
    const response = await axios.post<PmsExtensionResponse>(`${API_URL}/pms/extension/update`, {
      domain_name: DOMAIN_NAME,
      extension,
      toll_allow: tollAllow,
      effective_caller_id_name: effectiveCallerIdName,
      effective_caller_id_number: effectiveCallerIdNumber,
      reloadxml: true,
    }, { headers: HEADERS });
    console.log(`[freeSwitchPmsApi] update(分機=${extension}) HTTP ${response.status}`, response.data);
    return { success: true, data: response.data };
  } catch (err) {
    console.error(`[freeSwitchPmsApi] update(分機=${extension}) 失敗:`, err);
    return { success: false, error: err };
  }
}
