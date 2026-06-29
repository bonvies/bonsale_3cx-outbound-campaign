import { ApiResult, IPhoneApiService } from '../phoneApiService';
import axios, { AxiosInstance } from 'axios';

const DEFAULT_API_URL = 'http://127.0.0.1:5002';
const DEFAULT_API_KEY = 'Bonvies42633506';

let client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (!client) throw new Error('[freeSwitchApi] FreeSWITCH 尚未初始化，請確認 init() 已執行');
  return client;
}

type MakeMorningCallResponse = {
  status: 'success' | 'failed' | 'error';
  call_details?: Record<string, unknown>;
  freeswitch_reply?: string;
  error_detail?: string;
  message?: string;
};

export const freeSwitchDevice: IPhoneApiService = {
  async init(): Promise<void> {
    if (!process.env.FREESWITCH_API_URL) throw Error('尚未設定 FreeSwitch 設備端點');
    const apiUrl = process.env.FREESWITCH_API_URL ?? DEFAULT_API_URL;
    const apiKey = process.env.FREESWITCH_API_KEY ?? DEFAULT_API_KEY;

    client = axios.create({
      baseURL: apiUrl,
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
    });

    const health = await getClient().get<{ status: string }>(`${apiUrl}/health`);
    if (health.data.status !== 'ok') {
      throw new Error(`[freeSwitchApi] py-dialer 健康檢查失敗：${JSON.stringify(health.data)}`);
    }

    console.log(`[freeSwitchApi] 初始化完成，API: ${apiUrl}`);
  },

  async makeCall(from: string, to: string): Promise<ApiResult<unknown>> {
    try {
      const response = await getClient().post<MakeMorningCallResponse>('/make_morning_call', {
        room_number: to,
        caller_id: from,
      });

      const json = response.data;
      console.log(`[freeSwitchApi] makeCall(${from} → ${to}) HTTP ${response.status}`, json);

      if (json.status === 'success') {
        return { success: true, data: json };
      }

      return { success: false, error: json.error_detail ?? json.message ?? json };
    } catch (err) {
      console.error(`[freeSwitchApi] makeCall(${from} → ${to}) 失敗:`, err);
      return { success: false, error: err };
    }
  },
};
