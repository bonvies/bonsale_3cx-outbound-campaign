import { http10Post } from '@call-schedule/util/http10-client';
import { ApiResult, IPhoneApiService } from '../phoneApiService';

const NEW_ROCK_API_HOST = process.env.NEW_ROCK_API_HOST;
const NEW_ROCK_API_PATH = process.env.NEW_ROCK_API_PATH;
if (!NEW_ROCK_API_HOST) throw new Error('[newRockApi] 環境變數 NEW_ROCK_API_HOST 未設定');
if (!NEW_ROCK_API_PATH) throw new Error('[newRockApi] 環境變數 NEW_ROCK_API_PATH 未設定');

export const newRockDevice: IPhoneApiService = {
  async makeCall(from: string, to: string): Promise<ApiResult<unknown>> {
    const xmlData = `
      <?xml version="1.0" encoding="utf-8" ?>
      <Transfer attribute="Connect">
          <ext id="${from}"/>
          <ext id="${to}"/>
      </Transfer>
    `;

    try {
      const response = await http10Post(NEW_ROCK_API_HOST, NEW_ROCK_API_PATH, xmlData, {
        headers: { 'Content-Type': 'text/xml' },
      });
      return { success: true, data: response };
    } catch (error) {
      console.error('錯誤:', (error as Error).message);
      return { success: false, error };
    }
  },
};
