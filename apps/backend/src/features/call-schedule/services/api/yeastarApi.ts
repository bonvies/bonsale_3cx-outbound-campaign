import https from 'https';
import axios from 'axios';
import { ApiResult } from './phoneApiService';
import { TokenResponseType, callDialType } from '@/features/call-schedule/types/api/yeastarApi';
import dotenv from 'dotenv';

dotenv.config();

// Yeastar 設備使用自簽憑證，允許跳過驗證
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const HEADERS = { 'User-Agent': 'OpenAPI' };
const HOST = `${process.env.YEASTAR_API_HOST}${process.env.YEASTAR_API_PATH}`;

// 取得 access token / refresh token
export async function getToken(username: string, password: string): Promise<ApiResult<TokenResponseType>> {
  try {
    const response = await axios.post<TokenResponseType>(`${HOST}/get_token`, { username, password }, {
      headers: HEADERS,
      httpsAgent,
    });
    return { success: true, data: response.data };
  } catch (err) {
    console.error('[yeastarApi] getToken 失敗:', err);
    return { success: false, error: err };
  }
}

// 用現有 refresh_token 刷新 access token
export async function refreshToken(currentRefreshToken: string): Promise<ApiResult<TokenResponseType>> {
  try {
    const response = await axios.post<TokenResponseType>(`${HOST}/refresh_token`, { refresh_token: currentRefreshToken }, {
      headers: HEADERS,
      httpsAgent,
    });
    return { success: true, data: response.data };
  } catch (err) {
    console.error('[yeastarApi] refreshToken 失敗:', err);
    return { success: false, error: err };
  }
}

// 撥打電話
export async function dial(accessToken: string, from: string, to: string): Promise<ApiResult<callDialType>> {
  try {
    const response = await axios.post<callDialType>(`${HOST}/call/dial?access_token=${accessToken}`, {
      caller: from,
      callee: to,
    }, {
      headers: HEADERS,
      httpsAgent,
    });
    return { success: true, data: response.data };
  } catch (err) {
    console.error('[yeastarApi] dial 失敗:', err);
    return { success: false, error: err };
  }
}
