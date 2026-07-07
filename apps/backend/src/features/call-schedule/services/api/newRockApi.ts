import { http10Post } from '@call-schedule/util/http10-client';
import { ApiResult } from '../callService/phoneApiService';
import dotenv from 'dotenv';

dotenv.config();

const HOST = `${process.env.NEW_ROCK_API_HOST}`;
const PATH = `${process.env.NEW_ROCK_API_PATH}`;

// 撥打電話（Transfer/Connect 讓兩個分機互相接通）
export async function makeCall(from: string, to: string): Promise<ApiResult<unknown>> {
  const xmlData = `
    <?xml version="1.0" encoding="utf-8" ?>
    <Transfer attribute="Connect">
        <ext id="${from}"/>
        <ext id="${to}"/>
    </Transfer>
  `;

  try {
    const response = await http10Post(HOST, PATH, xmlData, {
      headers: { 'Content-Type': 'text/xml' },
    });
    return { success: true, data: response };
  } catch (error) {
    console.error('[newRockApi] makeCall 失敗:', (error as Error).message);
    return { success: false, error };
  }
}
