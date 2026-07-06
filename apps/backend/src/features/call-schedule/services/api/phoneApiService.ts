import { newRockDevice } from './device/newRock';
import { yeastarDevice } from './device/yeastar';
import { freeSwitchDevice } from './device/freeSwitch';

// ─────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────

export interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: unknown;
}

export interface IPhoneApiService {
  /**
   * 前置初始化（可選）
   * 需要 token 取得或定時刷新的設備才需實作，例如 Yeastar。
   * 在 call-schedule feature 啟動時呼叫一次。
   */
  init?(): Promise<void>;
  makeCall(from: string, to: string): Promise<ApiResult<unknown>>;
}

// ─────────────────────────────────────────────
// Implementations
// ─────────────────────────────────────────────

const devices: Record<'NewRock' | 'Yeastar' | 'FreeSwitch', IPhoneApiService> = {
  NewRock: newRockDevice,
  Yeastar: yeastarDevice,
  FreeSwitch: freeSwitchDevice,
};

function getDevice(): IPhoneApiService {
  const raw = process.env.TELEPHONE_EQUIPMENT;
  if (!raw) throw new Error('[phoneApiService] 環境變數 TELEPHONE_EQUIPMENT 未設定（NewRock / Yeastar / FreeSwitch）');
  if (raw !== 'NewRock' && raw !== 'Yeastar' && raw !== 'FreeSwitch') throw new Error(`[phoneApiService] TELEPHONE_EQUIPMENT 值無效：「${raw}」，只接受 NewRock、Yeastar 或 FreeSwitch`);
  return devices[raw];
}

export const phoneApiService: IPhoneApiService = {
  init: () => getDevice().init?.() ?? Promise.resolve(),
  makeCall: (from, to) => getDevice().makeCall(from, to),
};
