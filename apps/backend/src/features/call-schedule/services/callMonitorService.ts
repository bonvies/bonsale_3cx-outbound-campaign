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

const TELEPHONE_EQUIPMENT = process.env.TELEPHONE_EQUIPMENT as 'NewRock' | 'Yeastar';

const monitors: Record<'NewRock' | 'Yeastar', ICallMonitorService> = {
  NewRock: newRockCallMonitor,
  Yeastar: yeastarCallMonitor,
};

const callMonitor = monitors[TELEPHONE_EQUIPMENT];

// ─────────────────────────────────────────────
// Re-exports（維持 callScheduleService / app.ts 的 import 不變）
// ─────────────────────────────────────────────

export const startCallMonitorServer = () => callMonitor.start();
export const registerCall = (opts: RegisterCallOptions) => callMonitor.registerCall(opts);
export const cancelScheduleJobs = (
  scheduleId: string,
  scheduledJobs: Record<string, { cancel: () => void }>,
) => callMonitor.cancelScheduleJobs(scheduleId, scheduledJobs);

export type { RegisterCallOptions };
