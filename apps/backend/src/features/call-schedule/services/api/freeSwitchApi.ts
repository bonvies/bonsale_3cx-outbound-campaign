import axios from 'axios';
import { ApiResult } from '../callService/phoneApiService';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_API_URL = 'http://127.0.0.1:5002';
const DEFAULT_API_KEY = 'Bonvies42633506';

export const API_URL = process.env.FREESWITCH_API_URL ?? DEFAULT_API_URL;
const API_KEY = process.env.FREESWITCH_API_KEY ?? DEFAULT_API_KEY;
const HEADERS = {
  'Content-Type': 'application/json',
  'X-API-KEY': API_KEY,
};

type MakeMorningCallResponse = {
  status: 'success' | 'failed' | 'error';
  call_details?: Record<string, unknown>;
  freeswitch_reply?: string;
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

// 撥打電話（morning call）
export async function makeMorningCall(from: string, to: string): Promise<ApiResult<unknown>> {
  try {
    const response = await axios.post<MakeMorningCallResponse>(`${API_URL}/make_morning_call`, {
      room_number: to,
      caller_id: from,
    }, { headers: HEADERS });

    const json = response.data;
    console.log(`[freeSwitchApi] makeMorningCall(${from} → ${to}) HTTP ${response.status}`, json);

    if (json.status === 'success') {
      return { success: true, data: json };
    }
    return { success: false, error: json.error_detail ?? json.message ?? json };
  } catch (err) {
    console.error(`[freeSwitchApi] makeMorningCall(${from} → ${to}) 失敗:`, err);
    return { success: false, error: err };
  }
}
