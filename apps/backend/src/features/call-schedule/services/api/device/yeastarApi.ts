import https from 'https';
import { ApiResult, IPhoneApiService } from '../phoneApiService';
import { TokenResponseType, callDialType } from '@/features/call-schedule/types/api/yeastarApi';
import axios from 'axios';
import { warnWithTimestamp, errorWithTimestamp } from '@/shared/util/timestamp'

// Yeastar 設備使用自簽憑證，允許跳過驗證
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const YEASTAR_API_HOST = process.env.YEASTAR_API_HOST;
const YEASTAR_API_PATH = process.env.YEASTAR_API_PATH;
const YEASTAR_USERNAME = process.env.YEASTAR_USERNAME;
const YEASTAR_PASSWORD = process.env.YEASTAR_PASSWORD;
if (!YEASTAR_API_HOST) throw new Error('[yeastarApi] 環境變數 YEASTAR_API_HOST 未設定');
if (!YEASTAR_API_PATH) throw new Error('[yeastarApi] 環境變數 YEASTAR_API_PATH 未設定');
if (!YEASTAR_USERNAME) throw new Error('[yeastarApi] 環境變數 YEASTAR_USERNAME 未設定');
if (!YEASTAR_PASSWORD) throw new Error('[yeastarApi] 環境變數 YEASTAR_PASSWORD 未設定');

const axiosYeastarInstance = axios.create({
  baseURL: YEASTAR_API_HOST + YEASTAR_API_PATH,
  headers: { 'User-Agent': 'OpenAPI' },
  httpsAgent,
});

let accessToken: string | null = null;

async function fetchToken(): Promise<TokenResponseType> {
  const response = await axiosYeastarInstance.post('/get_token', {
    username: YEASTAR_USERNAME,
    password: YEASTAR_PASSWORD,
  });
  accessToken = response.data.access_token;
  return response.data;
}

async function refreshToken(currentRefreshToken: string): Promise<TokenResponseType> {
  const response = await axiosYeastarInstance.post('/refresh_token', {
    refresh_token: currentRefreshToken,
  });
  accessToken = response.data.access_token;
  return response.data;
}

const RETRY_INTERVAL_MS = 60 * 1000; // refresh 失敗時，60 秒後重試

/**
 * 用 setTimeout 遞迴排程，確保每次都使用最新的 refresh_token。
 * refreshToken 失敗時 fallback 到 fetchToken 重新取得憑證，
 * 避免斷網超過 refresh_token_expire_time 後永遠無法恢復。
 */
async function scheduleTokenRefresh(tokenData: TokenResponseType): Promise<void> {
  setTimeout(async () => {
    try {
      const newTokenData = await refreshToken(tokenData.refresh_token);
      scheduleTokenRefresh(newTokenData);
    } catch {
      // refresh_token 過期或網路異常 → 重新 fetchToken
      try {
        warnWithTimestamp('[yeastarApi] refresh_token 失敗，嘗試重新 fetchToken');
        const newTokenData = await fetchToken();
        scheduleTokenRefresh(newTokenData);
      } catch {
        // fetchToken 也失敗（網路仍斷線）→ 60 秒後再試
        errorWithTimestamp(`[yeastarApi] fetchToken 失敗，${RETRY_INTERVAL_MS / 1000} 秒後重試`);
        setTimeout(() => scheduleTokenRefresh(tokenData), RETRY_INTERVAL_MS);
      }
    }
  }, tokenData.access_token_expire_time * 1000);
}

export function getYeastarAccessToken(): string | null {
  return accessToken;
}

export function getYeastarApiHost(): string {
  return YEASTAR_API_HOST!;
}

export const yeastarDevice: IPhoneApiService = {
  async init() {
    const tokenData = await fetchToken();
    scheduleTokenRefresh(tokenData);
  },

  async makeCall(from: string, to: string): Promise<ApiResult<callDialType>> {
    const response = await axiosYeastarInstance.post(`/call/dial?access_token=${accessToken}`, {
      caller: from,
      callee: to,
    });
    return { success: true, data: response.data };
  },
};
