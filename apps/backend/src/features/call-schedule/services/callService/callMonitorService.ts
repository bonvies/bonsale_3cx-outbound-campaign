import { Router } from 'express';
import { newRockCallMonitor } from './monitor/device/NewRockCallMonitorService';
import { yeastarCallMonitor } from './monitor/device/YeastarCallMonitorService';
import { freeSwitchCallMonitor } from './monitor/device/FreeSwitchCallMonitorService';
import { RegisterCallOptions } from './monitor/callMonitorCore';

// ─────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────

export interface ICallMonitorService {
  // router 由 FreeSwitch 模式用來在既有 Express placeholder 上掛載 CDR 路由；
  // NewRock / Yeastar 自行開 server / WebSocket，忽略此參數
  start(router?: Router): void;
  registerCall(opts: RegisterCallOptions): void;
  cancelScheduleJobs(scheduleId: string, scheduledJobs: Record<string, { cancel: () => void }>): void;
}

// ─────────────────────────────────────────────
// Switching point
// ─────────────────────────────────────────────

const monitors: Record<'NewRock' | 'Yeastar' | 'FreeSwitch', ICallMonitorService> = {
  NewRock: newRockCallMonitor,
  Yeastar: yeastarCallMonitor,
  FreeSwitch: freeSwitchCallMonitor,
};

function getMonitor(): ICallMonitorService {
  const raw = process.env.TELEPHONE_EQUIPMENT;
  if (!raw) throw new Error('[callMonitorService] 環境變數 TELEPHONE_EQUIPMENT 未設定（NewRock / Yeastar / FreeSwitch）');
  if (raw !== 'NewRock' && raw !== 'Yeastar' && raw !== 'FreeSwitch') throw new Error(`[callMonitorService] TELEPHONE_EQUIPMENT 值無效：「${raw}」，只接受 NewRock、Yeastar 或 FreeSwitch`);
  return monitors[raw];
}

// ─────────────────────────────────────────────
// Re-exports（維持 callScheduleService / app.ts 的 import 不變）
// ─────────────────────────────────────────────

export const startCallMonitorServer = (router?: Router) => getMonitor().start(router);
export const registerCall = (opts: RegisterCallOptions) => getMonitor().registerCall(opts);
export const cancelScheduleJobs = (
  scheduleId: string,
  scheduledJobs: Record<string, { cancel: () => void }>,
) => getMonitor().cancelScheduleJobs(scheduleId, scheduledJobs);

export type { RegisterCallOptions };
