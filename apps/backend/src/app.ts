// ─────────────────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────────────────

import './shared/util/patchConsole'; // 必須在所有 import 之前，全域 override console 加入 timestamp
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

// 共用設定 API
import configRouter from './shared/routes/config';
import { validateEnv } from './shared/util/validateEnv';

// 語音通知 (Call Schedule)
// 註：這些模組載入時只會把環境變數讀成常數、建立物件，不會因缺漏而 throw
//     （設備選擇在呼叫時才執行），因此可以靜態 import；缺漏與否交給下方 validateEnv() 統一檢查。
import callScheduleRouter from './features/call-schedule/routes/callSchedule';
import lakeshoreRouter from './features/call-schedule/routes/hotel/lakeshore';
import { initDatabase } from './features/call-schedule/services/database';
import { startCallMonitorServer } from './features/call-schedule/services/callService/callMonitorService';
import { recoverPendingSchedules } from './features/call-schedule/services/callService/callScheduleService';
import { phoneApiService } from './features/call-schedule/services/callService/phoneApiService';
import fiasHandler from './features/call-schedule/components/fiasHandler';
import { createServer as createFiasServer } from './features/call-schedule/util/fias';
import { connectToPms } from './features/call-schedule/util/fiasClient';
import { setFiasConn } from './features/call-schedule/util/fiasConnectionStore';
import { FiasWakeupResultHandler } from './features/call-schedule/components/fiasWakeupResultHandler';
import { registerCallResultHandler } from './features/call-schedule/services/callService/monitor/callResultNotifier';

// ─────────────────────────────────────────────────────────────────────────────
// 環境設定
// ─────────────────────────────────────────────────────────────────────────────

dotenv.config();

/**
 * 依目前的組合（TELEPHONE_EQUIPMENT / ENABLE_FIAS / FIAS_MODE）一次驗證環境變數，
 * 缺漏或填錯會在此處列出並終止服務。完整規則請見 apps/backend/.env.example
 * 與 shared/util/validateEnv.ts。
 *
 *   ENABLE_FIAS=true                → 啟用 FIAS TCP 伺服器／客戶端（預設 true）
 *   ENABLE_FIAS=false               → 停用 FIAS（不佔用 TCP port，適合 Cloud Run）
 */
validateEnv();

const ENABLE_FIAS = process.env.ENABLE_FIAS !== 'false'; // 預設 true，設 false 可停用
const CLIENT_ID = process.env.CLIENT_ID; // 用於掛載/啟用特定客戶的客製化程式區段（例如 lakeshore 專屬路由）

const PORT = process.env.HTTP_PORT || 4020; // HTTP 主服務埠
const FIAS_PORT = process.env.FIAS_PORT || 4021; // FIAS TCP 伺服器埠

// ─────────────────────────────────────────────────────────────────────────────
// Express 應用程式設定
// ─────────────────────────────────────────────────────────────────────────────

const app: express.Application = express();

// Middleware
app.use(helmet());                              // 設定安全相關 HTTP headers
app.use(cors());                               // 允許跨來源請求
app.use(morgan('dev'));                         // 輸出 HTTP 請求日誌
app.use(express.json({ limit: '10mb' }));      // 解析 JSON body（限 10MB）
app.use(express.urlencoded({ extended: true })); // 解析 URL-encoded form data

// ─────────────────────────────────────────────────────────────────────────────
// 路由掛載
// ─────────────────────────────────────────────────────────────────────────────

app.use('/api/config', configRouter);        // 站點設定 API（時區等）

// 語音通知路由
// 註：FreeSWITCH 的 CDR webhook（/freeswitch-webhook）由 FreeSwitchCallMonitorService
//     在 startCallMonitorServer() 時才掛到 callScheduleRouter 上，僅 TELEPHONE_EQUIPMENT=FreeSwitch 時生效。
//     Express 在收到請求時才比對 router 內的路由，所以「先掛 app、之後才加路由」仍會生效。
app.use('/api/call-schedule', callScheduleRouter);

// 客戶專屬路由：依 CLIENT_ID 掛載對應的客製化程式區段，新增客戶時在此加一個 case
switch (CLIENT_ID) {
  case 'lakeshore':
    app.use('/api/v1/lakeshore', lakeshoreRouter);
    break;
  default:
    break;
}

// 根路由：健康檢查 / 版本確認
app.get('/', (_req, res) => {
  res.json({ message: 'Welcome to the API', version: '0.0.1', clientId: CLIENT_ID });
});

// 404 handler：攔截所有未匹配的路由
app.use('*', (_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// 全域錯誤處理：Express 的最後一道錯誤防線
// 若 development 環境，額外回傳 stack trace 方便除錯
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 語音通知 (Call Schedule)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 語音通知的開機流程（依序執行，於 server 開始 listen 後呼叫）：
 * 1. 初始化 SQLite 資料庫
 * 2. 初始化電話設備（失敗時僅 log，不中斷啟動）
 * 3. 恢復重啟前未執行的排程任務
 * 4. 啟動通話狀態監控（失敗時僅 log，不中斷啟動）
 * 5. 啟動 FIAS TCP 伺服器／客戶端
 */
async function setupCallSchedule(): Promise<void> {
  // ── 資料庫初始化 ──────────────────────────────────────────────────────────
  await initDatabase();

  // ── 電話設備初始化 ────────────────────────────────────────────────────────
  // 失敗時僅 log，不中斷啟動——排程與監控照常啟動，撥號時才回報設備錯誤
  try {
    await phoneApiService.init?.();
  } catch (error) {
    console.error('❌ [CallSchedule] 話機設備初始化失敗，排程將繼續啟動但無法撥出電話:', error);
  }

  // ── 排程恢復 ──────────────────────────────────────────────────────────────
  recoverPendingSchedules();

  // ── 通話狀態監控 ──────────────────────────────────────────────────────────
  // 失敗時僅 log，不中斷啟動——設備未設定時監控無法啟動，但 server 照常運行
  try {
    startCallMonitorServer(callScheduleRouter);
  } catch (error) {
    console.error('❌ [CallSchedule] 通話監控啟動失敗:', error);
  }

  // ── FIAS TCP ──────────────────────────────────────────────────────────────
  // ENABLE_FIAS=false → 跳過，不佔用 TCP port（適合 Cloud Run 等單 port 環境）
  // FIAS_MODE=server（預設）：開 TCP server，等 PMS 連入
  // FIAS_MODE=client        ：主動連至 PMS TCP server（煙波等 PMS SERVER 模式）
  if (!ENABLE_FIAS) {
    console.log('📡 FIAS 已停用（ENABLE_FIAS=false），跳過 TCP 初始化');
  } else {
    // FiasWakeupResultHandler 是協定層級的邏輯（依 FIAS 規格回報 WA），只要有啟用
    // FIAS 就該註冊，不分客戶。若某飯店需要額外的客製化通知（非 FIAS 規格要求），
    // 在這裡另外 registerCallResultHandler(new 該飯店Handler()) 即可，兩者互不影響。
    registerCallResultHandler(new FiasWakeupResultHandler());

    const FIAS_MODE = process.env.FIAS_MODE ?? 'server';

    if (FIAS_MODE === 'client') {
      const FIAS_PMS_HOST = process.env.FIAS_PMS_HOST;
      const FIAS_PMS_PORT = parseInt(process.env.FIAS_PMS_PORT ?? String(FIAS_PORT), 10);

      if (!FIAS_PMS_HOST) {
        console.error('❌ [CallSchedule] FIAS_MODE=client 但未設定 FIAS_PMS_HOST，跳過 FIAS 連線');
      } else {
        const FIAS_HEARTBEAT = parseInt(process.env.FIAS_HEARTBEAT_INTERVAL_MS ?? '0', 10);
        connectToPms(
          { host: FIAS_PMS_HOST, port: FIAS_PMS_PORT, heartbeatIntervalMs: FIAS_HEARTBEAT },
          async (msg, conn) => {
            console.log('--- FIAS TCP 客戶端收到訊息 ---');
            console.log('訊息內容:', msg);
            fiasHandler(msg, conn);
          },
          () => setFiasConn(null),
        );
        console.log(`📡 FIAS TCP 客戶端正在連線至 PMS ${FIAS_PMS_HOST}:${FIAS_PMS_PORT}...`);
      }
    } else {
      const fiasServer = createFiasServer(
        async (msg, conn) => {
          console.log('--- FIAS TCP 服務器收到訊息 ---');
          console.log('訊息內容:', msg);
          fiasHandler(msg, conn);
        },
        () => setFiasConn(null),
      );

      fiasServer.listen(FIAS_PORT, () => {
        console.log(`📡 FIAS TCP server is running on port ${FIAS_PORT}`);
      });
    }
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// 啟動伺服器
// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  try {
    await setupCallSchedule();

    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🕐 Site timezone: ${process.env.SITE_TIMEZONE}`);
    console.log(`ℹ️ Version: v3.0.2`);

  } catch (error) {
    console.error('啟動服務器失敗:', error);
    process.exit(1);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 優雅關閉
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 收到作業系統終止信號後退出：
 *   SIGINT  : 終端 Ctrl+C（開發環境常用）
 *   SIGTERM : Docker / Kubernetes 發送的正常關閉指令
 *
 * SQLite（better-sqlite3）為同步寫入，無需額外 flush。
 */
function gracefulShutdown(signal: string): void {
  console.log(`收到 ${signal} 信號，正在關閉服務器...`);
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// 捕獲所有未處理的 Promise rejection，避免 Node.js 15+ 預設直接終止進程
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Promise Rejection:', { reason, promise });
});

export default app;
