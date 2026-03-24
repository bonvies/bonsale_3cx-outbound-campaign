import https from 'https';
import { ApiResult, IPhoneApiService } from '../phoneApiService';
import { TokenResponseType, callDialType } from '../../../types/api/yeastarApi';
import axios from 'axios';

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

/** 用 setTimeout 遞迴排程，確保每次都使用最新的 refresh_token */
function scheduleTokenRefresh(tokenData: TokenResponseType): void {
  setTimeout(async () => {
    const newTokenData = await refreshToken(tokenData.refresh_token);
    scheduleTokenRefresh(newTokenData);
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
