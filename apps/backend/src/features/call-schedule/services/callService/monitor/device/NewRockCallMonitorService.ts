import http from 'http';
import { ICallMonitorService } from '../../callMonitorService';
import {
  handleRing, handleAnswer, handleBye, clearPendingCall,
  registerCall, cancelScheduleJobs,
  getPendingCalls,
  RegisterCallOptions,
} from '../callMonitorCore';

const NEW_ROCK_API_MONITOR_PORT = parseInt(process.env.NEW_ROCK_API_MONITOR_PORT!);

function connect(): void {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      // 立即回應 200，避免 OM 裝置等待
      res.writeHead(200, { Connection: 'close', 'Content-Type': 'text/plain' });
      res.end();
      console.log(body);
      if (!body) return;

      // 從 body 抓出所有 <ext id="xxxx">，找出有在 pendingCalls 追蹤的那個
      const pendingCalls = getPendingCalls();
      const allExts = [...body.matchAll(/id="(\d+)"/g)].map(m => m[1]);
      const trackedExt = allExts.find(e => pendingCalls.has(e));
      const firstExt = allExts[0];

      if (body.includes('attribute="RING"')) {
        if (trackedExt) handleRing(trackedExt);
      } else if (body.includes('attribute="ANSWER"')) {
        // 我方接聽
        console.log(`[CallMonitor] 📞 ANSWER ext=${firstExt ?? '?'}`);
      } else if (body.includes('attribute="ANSWERED"')) {
        // 對方接聽
        if (trackedExt) handleAnswer(trackedExt);
      } else if (body.includes('attribute="FAILED"')) {
        if (trackedExt) handleBye(trackedExt).catch((err) =>
          console.error('[CallMonitor] handleBye (FAILED) error:', err)
        );
      } else if (body.includes('attribute="IDLE"')) {
        if (trackedExt) handleBye(trackedExt).catch((err) =>
          console.error('[CallMonitor] handleBye (IDLE) error:', err)
        );
      } else if (body.includes('attribute="BYE"')) {
        // 我方掛斷，通話正常結束 → 不觸發重試，只清除監控
        console.log(`[CallMonitor] 📴 BYE ext=${firstExt ?? '?'}（我方掛斷）`);
        if (trackedExt) clearPendingCall(trackedExt);
      } else if (body.includes('attribute="BUSY"')) {
        console.log(`[CallMonitor] 📴 BUSY ext=${firstExt ?? '?'}`);
      } else if (body.includes('<Cdr')) {
        const duration = body.match(/<Duration>(\d+)<\/Duration>/)?.[1];
        console.log(`[CallMonitor] 📊 通話記錄 ext=${firstExt ?? '?'} 通話時長=${duration ?? '?'} 秒`);
      }
    });
  });

  server.listen(NEW_ROCK_API_MONITOR_PORT, () => {
    console.log(`[CallMonitor] 🚀 NewRock 事件監聽伺服器啟動於 Port ${NEW_ROCK_API_MONITOR_PORT}`);
  });
}

export const newRockCallMonitor: ICallMonitorService = {
  registerCall,
  cancelScheduleJobs,

  start(_router?) {
    console.log('[NewRockMonitor] 🚀 啟動 NewRock 事件監聽');
    connect();
  },
};

export type { RegisterCallOptions };
