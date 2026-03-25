import { http10Post } from '@call-schedule/util/http10-client';
import { ApiResult, IPhoneApiService } from '../phoneApiService';

let apiHost: string | null = null;
let apiPath: string | null = null;

export function getNewRockApiHost(): string {
  if (!apiHost) throw new Error('[newRockApi] NewRock 尚未初始化，請確認 init() 已執行');
  return apiHost;
}

export const newRockDevice: IPhoneApiService = {
  async init() {
    const host = process.env.NEW_ROCK_API_HOST;
    const path = process.env.NEW_ROCK_API_PATH;
    if (!host) throw new Error('[newRockApi] 環境變數 NEW_ROCK_API_HOST 未設定');
    if (!path) throw new Error('[newRockApi] 環境變數 NEW_ROCK_API_PATH 未設定');
    apiHost = host;
    apiPath = path;
  },

  async makeCall(from: string, to: string): Promise<ApiResult<unknown>> {
    if (!apiHost || !apiPath) throw new Error('[newRockApi] NewRock 尚未初始化，請確認 init() 已執行');

    const xmlData = `
      <?xml version="1.0" encoding="utf-8" ?>
      <Transfer attribute="Connect">
          <ext id="${from}"/>
          <ext id="${to}"/>
      </Transfer>
    `;

    try {
      const response = await http10Post(apiHost, apiPath, xmlData, {
        headers: { 'Content-Type': 'text/xml' },
      });
      return { success: true, data: response };
    } catch (error) {
      console.error('錯誤:', (error as Error).message);
      return { success: false, error };
    }
  },
};
