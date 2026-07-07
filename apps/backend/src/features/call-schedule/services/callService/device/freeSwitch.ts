import { ApiResult, IPhoneApiService } from '../phoneApiService';
import * as freeSwitchApi from '../../api/freeSwitchApi';

export const freeSwitchDevice: IPhoneApiService = {
  async init(): Promise<void> {
    if (!process.env.FREESWITCH_API_URL) throw Error('尚未設定 FreeSwitch 設備端點');

    const health = await freeSwitchApi.healthCheck();
    if (!health.success || health.data?.status !== 'ok') {
      throw new Error(`[freeSwitch] py-dialer 健康檢查失敗：${JSON.stringify(health.error ?? health.data)}`);
    }

    console.log(`[freeSwitch] 初始化完成，API: ${freeSwitchApi.API_URL}`);
  },

  async makeCall(from: string, to: string): Promise<ApiResult<unknown>> {
    return freeSwitchApi.makeMorningCall(from, to);
  },
};
