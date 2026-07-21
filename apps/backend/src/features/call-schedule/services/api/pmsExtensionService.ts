import { ApiResult } from '../callService/phoneApiService';
import { TollAllow } from './freeSwitchPmsApi';
import { freeSwitchPmsExtension } from './device/freeSwitchPmsExtension';

type PmsExtensionResponse = Record<string, unknown>;

// 分機的 PMS 連動能力（入住/退房/改名或 DND、通話權限）——只有 FreeSwitch/FusionPBX 架構
// 目前有對應的 Middleware 可以呼叫，NewRock/Yeastar 沒有對應概念。三個方法都設計成可選，
// 比照 IPhoneApiService.init 的模式：不支援的設備直接不實作，呼叫端用「有沒有拿到結果」
// 判斷這個設備支不支援，不需要另外判斷「現在是哪個設備」（見 fiasHandler.ts）。
export interface IPmsExtensionService {
  checkin?(roomNumber: string, guestName: string, tollAllow: TollAllow, guestLanguage?: string): Promise<ApiResult<PmsExtensionResponse>>;
  checkout?(roomNumber: string): Promise<ApiResult<PmsExtensionResponse>>;
  update?(params: {
    extension: string;
    tollAllow?: TollAllow;
    effectiveCallerIdName?: string;
    effectiveCallerIdNumber?: string;
    doNotDisturb?: boolean;
  }): Promise<ApiResult<PmsExtensionResponse>>;
}

// NewRock/Yeastar 目前沒有 PMS 分機權限/顯示名稱管理的對應概念，三個方法都不實作即可，
// 不需要另外寫 device 檔案。之後若要支援，新增一個 device/xxxPmsExtension.ts 實作
// IPmsExtensionService、換掉這裡的 {} 就好，不需要改 fiasHandler.ts。
const devices: Record<'NewRock' | 'Yeastar' | 'FreeSwitch', IPmsExtensionService> = {
  NewRock: {},
  Yeastar: {},
  FreeSwitch: freeSwitchPmsExtension,
};

function getDevice(): IPmsExtensionService {
  const raw = process.env.TELEPHONE_EQUIPMENT;
  if (!raw) throw new Error('[pmsExtensionService] 環境變數 TELEPHONE_EQUIPMENT 未設定（NewRock / Yeastar / FreeSwitch）');
  if (raw !== 'NewRock' && raw !== 'Yeastar' && raw !== 'FreeSwitch') throw new Error(`[pmsExtensionService] TELEPHONE_EQUIPMENT 值無效：「${raw}」，只接受 NewRock、Yeastar 或 FreeSwitch`);
  return devices[raw];
}

// 統一包成「回傳 undefined 代表目前設備不支援這個動作」，呼叫端（fiasHandler.ts）
// 不需要再問「現在是不是 FreeSwitch」，只需要判斷有沒有拿到結果。
export const pmsExtensionService = {
  checkin: (roomNumber: string, guestName: string, tollAllow: TollAllow, guestLanguage?: string) =>
    Promise.resolve(getDevice().checkin?.(roomNumber, guestName, tollAllow, guestLanguage)),
  checkout: (roomNumber: string) =>
    Promise.resolve(getDevice().checkout?.(roomNumber)),
  update: (params: NonNullable<Parameters<NonNullable<IPmsExtensionService['update']>>[0]>) =>
    Promise.resolve(getDevice().update?.(params)),
};
