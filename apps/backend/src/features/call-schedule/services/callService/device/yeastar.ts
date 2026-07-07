import { ApiResult, IPhoneApiService } from '../phoneApiService';
import { TokenResponseType, callDialType } from '@/features/call-schedule/types/api/yeastarApi';
import * as yeastarApi from '../../api/yeastarApi';

const RETRY_INTERVAL_MS = 60 * 1000;

// baseUrl 與 token 在 init() 後才有值
let accessToken: string | null = null;

function getAccessToken(): string {
  if (!accessToken) throw new Error('[yeastar] Yeastar 尚未取得 access token，請確認 init() 已執行');
  return accessToken;
}

// ─────────────────────────────────────────────
// Token 管理
// ─────────────────────────────────────────────

/**
 * 用 setTimeout 遞迴排程，確保每次都使用最新的 refresh_token。
 * refreshToken 失敗時 fallback 到 getToken 重新取得憑證，
 * 避免斷網超過 refresh_token_expire_time 後永遠無法恢復。
 */
function scheduleTokenRefresh(tokenData: TokenResponseType, username: string, password: string) {
  setTimeout(async () => {
    const refreshResult = await yeastarApi.refreshToken(tokenData.refresh_token);
    if (refreshResult.success && refreshResult.data) {
      accessToken = refreshResult.data.access_token;
      scheduleTokenRefresh(refreshResult.data, username, password);
      return;
    }

    console.warn('[yeastar] refresh_token 失敗，嘗試重新 getToken');
    const tokenResult = await yeastarApi.getToken(username, password);
    if (tokenResult.success && tokenResult.data) {
      accessToken = tokenResult.data.access_token;
      scheduleTokenRefresh(tokenResult.data, username, password);
      return;
    }

    console.error(`[yeastar] getToken 失敗，${RETRY_INTERVAL_MS / 1000} 秒後重試`);
    setTimeout(() => scheduleTokenRefresh(tokenData, username, password), RETRY_INTERVAL_MS);
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
  if (!host) throw new Error('[yeastar] 環境變數 YEASTAR_API_HOST 未設定');
  return host;
}

export const yeastarDevice: IPhoneApiService = {
  async init() {
    const host = process.env.YEASTAR_API_HOST;
    const path = process.env.YEASTAR_API_PATH;
    const username = process.env.YEASTAR_USERNAME;
    const password = process.env.YEASTAR_PASSWORD;
    if (!host) throw new Error('[yeastar] 環境變數 YEASTAR_API_HOST 未設定');
    if (!path) throw new Error('[yeastar] 環境變數 YEASTAR_API_PATH 未設定');
    if (!username) throw new Error('[yeastar] 環境變數 YEASTAR_USERNAME 未設定');
    if (!password) throw new Error('[yeastar] 環境變數 YEASTAR_PASSWORD 未設定');

    const tokenResult = await yeastarApi.getToken(username, password);
    if (!tokenResult.success || !tokenResult.data) {
      throw new Error(`[yeastar] 初始化取得 token 失敗: ${JSON.stringify(tokenResult.error)}`);
    }

    accessToken = tokenResult.data.access_token;
    scheduleTokenRefresh(tokenResult.data, username, password);
  },

  async makeCall(from: string, to: string): Promise<ApiResult<callDialType>> {
    return yeastarApi.dial(getAccessToken(), from, to);
  },
};
