import { ApiResult, IPhoneApiService } from '../phoneApiService';
import * as newRockApi from '../../api/newRockApi';

export const newRockDevice: IPhoneApiService = {
  async init() {
    const host = process.env.NEW_ROCK_API_HOST;
    const path = process.env.NEW_ROCK_API_PATH;
    if (!host) throw new Error('[newRock] 環境變數 NEW_ROCK_API_HOST 未設定');
    if (!path) throw new Error('[newRock] 環境變數 NEW_ROCK_API_PATH 未設定');
  },

  async makeCall(from: string, to: string): Promise<ApiResult<unknown>> {
    return newRockApi.makeCall(from, to);
  },
};
