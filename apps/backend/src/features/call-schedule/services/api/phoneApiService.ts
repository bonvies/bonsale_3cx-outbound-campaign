import { newRockDevice } from './device/newRockApi';
import { yeastarDevice } from './device/yeastarApi';

// 目前只支援兩種設備：NewRock / Yeastar
// 透過環境變數 TELEPHONE_EQUIPMENT 切換，必填
const TELEPHONE_EQUIPMENT = process.env.TELEPHONE_EQUIPMENT;
if (!TELEPHONE_EQUIPMENT) throw new Error('[phoneApiService] 環境變數 TELEPHONE_EQUIPMENT 未設定（NewRock / Yeastar）');
if (TELEPHONE_EQUIPMENT !== 'NewRock' && TELEPHONE_EQUIPMENT !== 'Yeastar') throw new Error(`[phoneApiService] TELEPHONE_EQUIPMENT 值無效：「${TELEPHONE_EQUIPMENT}」，只接受 NewRock 或 Yeastar`);

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

export const phoneApiService: IPhoneApiService = devices[TELEPHONE_EQUIPMENT];
