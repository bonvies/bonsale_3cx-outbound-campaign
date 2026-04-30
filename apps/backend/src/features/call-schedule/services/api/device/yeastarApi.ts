import https from 'https';
import { ApiResult, IPhoneApiService } from '../phoneApiService';
import { TokenResponseType, callDialType } from '@/features/call-schedule/types/api/yeastarApi';
import axios, { AxiosInstance } from 'axios';
import { warnWithTimestamp, errorWithTimestamp } from '@/shared/util/timestamp';

// Yeastar 設備使用自簽憑證，允許跳過驗證
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const RETRY_INTERVAL_MS = 60 * 1000;

// axios instance 與 token 在 init() 後才有值
let client: AxiosInstance | null = null;
let accessToken: string | null = null;

function getClient(): AxiosInstance {
  if (!client) throw new Error('[yeastarApi] Yeastar 尚未初始化，請確認 init() 已執行');
  return client;
}

// ─────────────────────────────────────────────
// Token 管理
// ─────────────────────────────────────────────

async function fetchToken(username: string, password: string): Promise<TokenResponseType> {
  const response = await getClient().post('/get_token', { username, password });
  accessToken = response.data.access_token;
  return response.data;
}

async function refreshToken(currentRefreshToken: string): Promise<TokenResponseType> {
  const response = await getClient().post('/refresh_token', { refresh_token: currentRefreshToken });
  accessToken = response.data.access_token;
  return response.data;
}

/**
 * 用 setTimeout 遞迴排程，確保每次都使用最新的 refresh_token。
 * refreshToken 失敗時 fallback 到 fetchToken 重新取得憑證，
 * 避免斷網超過 refresh_token_expire_time 後永遠無法恢復。
 */
function scheduleTokenRefresh(tokenData: TokenResponseType, username: string, password: string) {
  setTimeout(async () => {
    try {
      const newTokenData = await refreshToken(tokenData.refresh_token);
      scheduleTokenRefresh(newTokenData, username, password);
    } catch {
      try {
        warnWithTimestamp('[yeastarApi] refresh_token 失敗，嘗試重新 fetchToken');
        const newTokenData = await fetchToken(username, password);
        scheduleTokenRefresh(newTokenData, username, password);
      } catch {
        errorWithTimestamp(`[yeastarApi] fetchToken 失敗，${RETRY_INTERVAL_MS / 1000} 秒後重試`);
        setTimeout(() => scheduleTokenRefresh(tokenData, username, password), RETRY_INTERVAL_MS);
      }
    }
  }, tokenData.access_token_expire_time * 1000);
}

// ─────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────

export function getYeastarAccessToken(): string | null {
  return accessToken;
}

export function getYeastarApiHost(): string {
  const host = process.env.YEASTAR_API_HOST;
  if (!host) throw new Error('[yeastarApi] 環境變數 YEASTAR_API_HOST 未設定');
  return host;
}

export const yeastarDevice: IPhoneApiService = {
  async init() {
    const host = process.env.YEASTAR_API_HOST;
    const path = process.env.YEASTAR_API_PATH;
    const username = process.env.YEASTAR_USERNAME;
    const password = process.env.YEASTAR_PASSWORD;
    if (!host) throw new Error('[yeastarApi] 環境變數 YEASTAR_API_HOST 未設定');
    if (!path) throw new Error('[yeastarApi] 環境變數 YEASTAR_API_PATH 未設定');
    if (!username) throw new Error('[yeastarApi] 環境變數 YEASTAR_USERNAME 未設定');
    if (!password) throw new Error('[yeastarApi] 環境變數 YEASTAR_PASSWORD 未設定');

    client = axios.create({
      baseURL: host + path,
      headers: { 'User-Agent': 'OpenAPI' },
      httpsAgent,
    });

    const tokenData = await fetchToken(username, password);
    scheduleTokenRefresh(tokenData, username, password);
  },

  async makeCall(from: string, to: string): Promise<ApiResult<callDialType>> {
    const response = await getClient().post(`/call/dial?access_token=${accessToken}`, {
      caller: from,
      callee: to,
    });
    return { success: true, data: response.data };
  },
};
