import { newRockDevice } from './device/newRockApi';
import { yeastarDevice } from './device/yeastarApi';

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

const devices: Record<'NewRock' | 'Yeastar', IPhoneApiService> = {
  NewRock: newRockDevice,
  Yeastar: yeastarDevice,
};

function getDevice(): IPhoneApiService {
  const raw = process.env.TELEPHONE_EQUIPMENT;
  if (!raw) throw new Error('[phoneApiService] 環境變數 TELEPHONE_EQUIPMENT 未設定（NewRock / Yeastar）');
  if (raw !== 'NewRock' && raw !== 'Yeastar') throw new Error(`[phoneApiService] TELEPHONE_EQUIPMENT 值無效：「${raw}」，只接受 NewRock 或 Yeastar`);
  return devices[raw];
}

export const phoneApiService: IPhoneApiService = {
  init: () => getDevice().init?.() ?? Promise.resolve(),
  makeCall: (from, to) => getDevice().makeCall(from, to),
};
