import { newRockCallMonitor } from './monitor/device/NewRockCallMonitorService';
import { yeastarCallMonitor } from './monitor/device/YeastarCallMonitorService';
import { RegisterCallOptions } from './monitor/callMonitorCore';

// ─────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────

export interface ICallMonitorService {
  start(): void;
  registerCall(opts: RegisterCallOptions): void;
  cancelScheduleJobs(scheduleId: string, scheduledJobs: Record<string, { cancel: () => void }>): void;
}

// ─────────────────────────────────────────────
// Switching point
// ─────────────────────────────────────────────

const monitors: Record<'NewRock' | 'Yeastar', ICallMonitorService> = {
  NewRock: newRockCallMonitor,
  Yeastar: yeastarCallMonitor,
};

function getMonitor(): ICallMonitorService {
  const raw = process.env.TELEPHONE_EQUIPMENT;
  if (!raw) throw new Error('[callMonitorService] 環境變數 TELEPHONE_EQUIPMENT 未設定（NewRock / Yeastar）');
  if (raw !== 'NewRock' && raw !== 'Yeastar') throw new Error(`[callMonitorService] TELEPHONE_EQUIPMENT 值無效：「${raw}」，只接受 NewRock 或 Yeastar`);
  return monitors[raw];
}

// ─────────────────────────────────────────────
// Re-exports（維持 callScheduleService / app.ts 的 import 不變）
// ─────────────────────────────────────────────

export const startCallMonitorServer = () => getMonitor().start();
export const registerCall = (opts: RegisterCallOptions) => getMonitor().registerCall(opts);
export const cancelScheduleJobs = (
  scheduleId: string,
  scheduledJobs: Record<string, { cancel: () => void }>,
) => getMonitor().cancelScheduleJobs(scheduleId, scheduledJobs);

export type { RegisterCallOptions };
