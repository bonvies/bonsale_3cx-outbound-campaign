import axios, { AxiosError } from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const host = process.env.HTTP_HOST_MESSAGE_FOR_AI;
const post9000BasicAuth = process.env.POST_9000_BASIC_AUTH;

if (!host) {
  throw new Error('環境變數 HTTP_HOST_MESSAGE_FOR_AI 未定義，請檢查 .env 文件');
}

if (!post9000BasicAuth) {
  throw new Error('環境變數 POST_9000_BASIC_AUTH 未定義，請檢查 .env 文件');
}

// AI 撥打所需的 API
/* 
  這是為 21 世紀 特別打造的 他們需要 post9000 來知道 AI 撥打的結果
  但我們會先用 post9000Dummy 送到 PY 那邊再去 呼叫 post9000
*/
export async function post9000Dummy(description: string, description2: string, phone: string): Promise<{ success: boolean; data?: unknown; error?: { errorCode: string; error: string } }> {
  try {
    const response = await axios.post(`${host}/InsertOverdueMessageForAi`, {
      CaseNo: description,
      Phone: phone,
      ResultCode: "9000",
      ContentText: "",
      SourceUrl: description2,
      startTime: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei', hour12: false }).replace(' ', 'T') + '+08:00',
    }, {
      headers: {
        Authorization: 'dummy',
      },
    });
    // 回傳 API 的回應
    return { success: true, data: response.data }; // 返回成功
  } catch (error: unknown) {
    const axiosError = error as AxiosError;
    console.error('Error post9000Dummy request:', axiosError.message);
    return {
      success: false,
      error: {
        errorCode: axiosError.response?.status?.toString() || '500',
        error: `Error post9000Dummy request: ${axiosError.message}`,
      },
    }; // 返回錯誤
  }
}

// AI 撥打所需的 API 2
/* 
  這是為 21 世紀 特別打造的 他們需要 post9000 來知道 AI 撥打的結果
  但我們會先用 post9000Dummy 送到 PY 那邊再去 呼叫 post9000
*/
export async function post9000(description: string, description2: string, phone: string): Promise<{ success: boolean; data?: unknown; error?: { errorCode: string; error: string } }> {
  try {
    const response = await axios.post(`${description2}/InsertOverdueMessageForAi`, {
      CaseNo: description,
      Phone: phone,
      ResultCode: "9000",
      ContentText: "",
      startTime: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei', hour12: false }).replace(' ', 'T') + '+08:00',
    }, {
      headers: {
        Authorization: `Basic ${post9000BasicAuth}`,
      },
    });
    // 回傳 API 的回應
    return { success: true, data: response.data }; // 返回成功
  } catch (error: unknown) {
    const axiosError = error as AxiosError;
    console.error('Error post9000 request:', axiosError.message);
    return {
      success: false,
      error: {
        errorCode: axiosError.response?.status?.toString() || '500',
        error: `Error post9000 request: ${axiosError.message}`,
      },
    }; // 返回錯誤
  }
}