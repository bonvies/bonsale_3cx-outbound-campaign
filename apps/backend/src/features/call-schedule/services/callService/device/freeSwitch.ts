import { ApiResult, IPhoneApiService } from '../phoneApiService';
import * as freeSwitchApi from '../../api/freeSwitchApi';

// FreeSwitch 的 makeMorningCall/makeCall 回應與稍後的 CDR callback 會帶同一個 request_id，
// 這是 FreeSwitch 協定自己的欄位名稱，只有這個設備的實作需要知道——正規化成 ApiResult.callId
// 供 callMonitorCore 精準比對（見 phoneApiService.ts 的 ApiResult.callId 說明）。
function extractRequestId(data: unknown): string | undefined {
  if (data && typeof data === 'object' && 'request_id' in data) {
    const requestId = (data as { request_id?: unknown }).request_id;
    return typeof requestId === 'string' ? requestId : undefined;
  }
  return undefined;
}

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
    const result = await freeSwitchApi.makeMorningCall(from, to);
    return { ...result, callId: extractRequestId(result.data) };
  },
};
