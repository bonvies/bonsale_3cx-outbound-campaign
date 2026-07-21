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
  // 供 callMonitorCore 的 pendingCalls 精準比對用（見 dequeueCall）。每個設備的通話結果回報
  // 帶的識別碼欄位名稱、有無都不一樣（例如 FreeSwitch 是 request_id），因此不在這裡假設任何
  // 協定細節，由各 IPhoneApiService 實作自行把自己的識別碼正規化填進這個共用欄位；沒有對應
  // 識別碼的設備（NewRock/Yeastar）就留空，callMonitorCore 會自動退回 FIFO 比對。
  callId?: string;
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
