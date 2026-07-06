// ─────────────────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────────────────

import './shared/util/patchConsole'; // 必須在所有 import 之前，全域 override console 加入 timestamp
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer } from 'ws';

// 共用設定 API
import configRouter from './shared/routes/config';
import sharedBonsaleRouter from './shared/routes/bonsale';
import { validateEnv } from './shared/util/validateEnv';

// 自動外播 (Outbound Campaign) 與 語音通知 (Call Schedule) 模組均採 dynamic import，
// 僅對應 feature flag 為 true 時才載入，避免停用時因缺少環境變數而在模組載入階段崩潰。

// ─────────────────────────────────────────────────────────────────────────────
// 環境設定 & Feature Flags
// ─────────────────────────────────────────────────────────────────────────────

dotenv.config();

/**
 * 功能開關與其餘環境變數，依目前啟用的組合（ENABLE_OUTBOUND_CAMPAIGN /
 * ENABLE_CALL_SCHEDULE / TELEPHONE_EQUIPMENT / FIAS_MODE）一次驗證，
 * 缺漏或填錯會在此處列出並終止服務。完整規則請見 apps/backend/.env.example
 * 與 shared/util/validateEnv.ts。
 *
 *   ENABLE_OUTBOUND_CAMPAIGN=true   → 啟用自動外播（連 Redis、建 WebSocket）
 *   ENABLE_OUTBOUND_CAMPAIGN=false  → 停用自動外播
 *   ENABLE_CALL_SCHEDULE=true       → 啟用語音通知（建 SQLite）
 *   ENABLE_CALL_SCHEDULE=false      → 停用語音通知
 *   ENABLE_FIAS=true                → 啟用 FIAS TCP 伺服器／客戶端（預設 true）
 *   ENABLE_FIAS=false               → 停用 FIAS（不佔用 TCP port，適合 Cloud Run）
 */
validateEnv();

const ENABLE_OUTBOUND_CAMPAIGN = process.env.ENABLE_OUTBOUND_CAMPAIGN === 'true';
const ENABLE_CALL_SCHEDULE = process.env.ENABLE_CALL_SCHEDULE === 'true';
const ENABLE_FIAS = process.env.ENABLE_FIAS !== 'false'; // 預設 true，設 false 可停用

const PORT = process.env.HTTP_PORT || 4020; // HTTP / WebSocket 主服務埠
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
// HTTP Server & WebSocket 基礎建設
// ─────────────────────────────────────────────────────────────────────────────

// 將 Express 包裝成 Node.js HTTP Server，以便同時掛載 WebSocket
const httpServer = createHttpServer(app);

/**
 * 主要 WebSocket 服務器（noServer 模式）
 *
 * noServer: true 表示不自行監聽 port，改由 httpServer 的 'upgrade' 事件
 * 手動分流，讓同一個 port 同時服務 HTTP 和 WebSocket。
 * 前端儀表板透過此 WebSocket 接收即時外播狀態更新。
 */
const mainWebSocketServer = new WebSocketServer({ noServer: true });

// ─────────────────────────────────────────────────────────────────────────────
// 路由掛載（依功能開關決定是否啟用）
// ─────────────────────────────────────────────────────────────────────────────

app.use('/api/config', configRouter);        // 功能設定 API（無條件掛載）
app.use('/api/bonsale', sharedBonsaleRouter); // Bonsale 共用 API（無條件掛載，不受 feature flag 影響）

// 自動外播路由：先以 placeholder router 佔位，確保排在 404 handler 之前。
// setupOutboundCampaign() 完成 dynamic import 後，才會將實際路由掛入 placeholder。
let outboundBonsaleRouter: express.Router | null = null;
let outboundControlRouter: express.Router | null = null;
if (ENABLE_OUTBOUND_CAMPAIGN) {
  outboundBonsaleRouter = express.Router();
  outboundControlRouter = express.Router();
  app.use('/api/bonsale', outboundBonsaleRouter);
  app.use('/api/outbound', outboundControlRouter);
}

// 語音通知路由：先以 placeholder router 佔位，確保排在 404 handler 之前。
// setupCallSchedule() 完成 dynamic import 後，才會將實際路由掛入 placeholder。
let callScheduleRouter_: express.Router | null = null;
let lakeshoreRouter_: express.Router | null = null;
if (ENABLE_CALL_SCHEDULE) {
  callScheduleRouter_ = express.Router();
  lakeshoreRouter_ = express.Router();
  app.use('/api/call-schedule', callScheduleRouter_);
  app.use('/api/lakeshore', lakeshoreRouter_);
}

// 根路由：健康檢查 / 版本確認
app.get('/', (_req, res) => {
  res.json({ message: 'Welcome to the API', version: '0.0.1' });
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
// WebSocket 升級請求分流
// ─────────────────────────────────────────────────────────────────────────────

/**
 * setupOutboundCampaign() 完成後由該函數設定。
 * 負責將 WebSocket upgrade 請求分流到 clientWsWebHook 或 mainWebSocketServer。
 * 未設定（ENABLE_OUTBOUND_CAMPAIGN=false 或 setup 尚未完成）時一律拒絕連線。
 */
let outboundUpgradeHandler: ((req: import('http').IncomingMessage, socket: import('stream').Duplex, head: Buffer) => void) | null = null;

httpServer.on('upgrade', (request, socket, head) => {
  if (outboundUpgradeHandler) {
    outboundUpgradeHandler(request, socket, head);
  } else {
    socket.destroy();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 自動外播 (Outbound Campaign)
// ─────────────────────────────────────────────────────────────────────────────

// setupOutboundCampaign() 完成後設定，供 gracefulShutdown 使用
let outboundCloseRedis: (() => Promise<void>) | null = null;

/**
 * 動態載入並初始化自動外播功能。
 *
 * 使用 dynamic import 確保 outbound-campaign 模組（含頂層 env 驗證的 callControl.ts）
 * 只在 ENABLE_OUTBOUND_CAMPAIGN=true 時才被載入，避免停用時因缺少 3CX 環境變數而崩潰。
 *
 * 完成以下工作：
 * 1. 動態載入所有 outbound-campaign 模組
 * 2. 將實際路由填入 placeholder router
 * 3. 設定 WebSocket upgrade 分流與連線處理
 * 4. 初始化 Redis 連線
 * 5. 恢復重啟前的活躍外播專案
 */
async function setupOutboundCampaign(): Promise<void> {
  const [
    { router: bonsaleRouter, clientWsWebHook },
    { createOutboundRouter },
    { initRedis, closeRedis },
    { broadcastAllProjects, broadcastError },
    { ProjectManager },
    { CallListManager },
    { default: Project },
  ] = await Promise.all([
    import('./features/outbound-campaign/routes/bonsale'),
    import('./features/outbound-campaign/routes/outbound'),
    import('./features/outbound-campaign/services/redis'),
    import('./features/outbound-campaign/components/broadcast'),
    import('./features/outbound-campaign/class/projectManager'),
    import('./features/outbound-campaign/class/callListManager'),
    import('./features/outbound-campaign/class/project'),
  ]);

  type ProjectInstance = InstanceType<typeof Project>;
  const activeProjects = new Map<string, ProjectInstance>();

  // ── 路由填入 placeholder ──────────────────────────────────────────────────
  outboundBonsaleRouter!.use('/', bonsaleRouter);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outboundControlRouter!.use('/', createOutboundRouter(activeProjects as any, mainWebSocketServer));

  // ── WebSocket upgrade 分流 ────────────────────────────────────────────────
  outboundUpgradeHandler = (request, socket, head) => {
    const pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;

    if (pathname === '/api/bonsale/WebHook') {
      // 3CX 推送通話狀態的 Webhook WebSocket
      clientWsWebHook.handleUpgrade(request, socket, head, (websocket) => {
        clientWsWebHook.emit('connection', websocket, request);
      });
    } else {
      // 前端儀表板的即時通訊 WebSocket
      mainWebSocketServer.handleUpgrade(request, socket, head, (websocket) => {
        mainWebSocketServer.emit('connection', websocket, request);
      });
    }
  };

  // ── 前端儀表板 WebSocket 連線處理 ─────────────────────────────────────────
  /**
   * 每當前端建立 WebSocket 連線時：
   * 1. 立即推送當前所有專案狀態
   * 2. 啟動心跳機制（每 60 秒 ping 一次）
   * 3. 監聽前端送來的操作事件（startOutbound / stopOutbound）
   */
  mainWebSocketServer.on('connection', async (wsClient) => {
    console.log('🔌 WebSocket client connected');

    // 新連線建立後，立即廣播當前所有專案狀態給該客戶端
    broadcastAllProjects(mainWebSocketServer);

    // ── 心跳機制 ──────────────────────────────────────────────────────────
    let isAlive = true;
    let heartbeatInterval: NodeJS.Timeout;

    const startHeartbeat = () => {
      heartbeatInterval = setInterval(() => {
        if (!isAlive) {
          console.log('💔 WebSocket client ping 超時，終止連線');
          wsClient.terminate();
          return;
        }
        isAlive = false;
        wsClient.ping();
      }, 60000);
    };

    startHeartbeat();
    wsClient.on('pong', () => { isAlive = true; });

    // ── 訊息處理 ──────────────────────────────────────────────────────────
    wsClient.on('message', async (message) => {
      try {
        const { event, payload } = JSON.parse(message.toString());

        switch (event) {
          // 前端發送的應用層心跳
          case 'ping':
            wsClient.send(JSON.stringify({ event: 'pong', timestamp: Date.now() }));
            break;

          // 啟動外播專案：初始化 Project 實例並建立 3CX WebSocket 連線
          case 'startOutbound':
            console.log('Received startOutbound event with payload:', payload);
            const projectInstance = await Project.initOutboundProject(payload.project);
            activeProjects.set(payload.project.projectId, projectInstance);
            projectInstance.setBroadcastWebSocket(mainWebSocketServer);
            projectInstance.setOnCompleteStop(() => activeProjects.delete(payload.project.projectId));
            await projectInstance.create3cxWebSocketConnection(mainWebSocketServer);
            break;

          // 停止外播專案：關閉 3CX 連線並從 activeProjects 移除
          case 'stopOutbound':
            console.log('停止 外撥事件:', payload.project);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const stopSuccess = await Project.stopOutboundProject(payload.project, activeProjects as any, mainWebSocketServer);
            if (!stopSuccess) {
              console.warn(`停止專案 ${payload.project.projectId} 失敗`);
            }
            break;

          default:
            console.warn('未知事件:', event);
        }
      } catch (error) {
        console.error('WebSocket message handling error:', error);
        broadcastError(mainWebSocketServer, error);
      }
    });

    // ── 連線關閉 / 錯誤 ───────────────────────────────────────────────────
    wsClient.on('close', () => {
      console.log('👋 WebSocket client disconnected');
      clearInterval(heartbeatInterval);
    });

    wsClient.on('error', (error) => {
      console.error('WebSocket client error:', error);
      clearInterval(heartbeatInterval);
    });
  });

  // ── Redis 初始化 ──────────────────────────────────────────────────────────
  outboundCloseRedis = closeRedis;
  await initRedis();

  // ── 恢復重啟前的活躍外播專案 ─────────────────────────────────────────────
  /**
   * 服務器重啟後，從 Redis 讀取上次的活躍專案清單，重新建立 Project 實例與
   * 3CX WebSocket 連線，讓外播得以從中斷點繼續進行。
   *
   * 行為取決於 AUTO_RECOVER_ON_RESTART 環境變數：
   *   true  → 逐一恢復 state==='active' 的專案
   *   false → 清空所有 Redis 中的專案狀態（全新啟動）
   */
  try {
    const autoRecover = process.env.AUTO_RECOVER_ON_RESTART;
    if (autoRecover === 'true') {
      console.log('🔄 檢查並恢復之前的活躍專案...');

      const allActiveProjects = await ProjectManager.getAllActiveProjects();

      if (allActiveProjects.length === 0) {
        console.log('📭 沒有發現需要恢復的專案');
        return;
      }

      console.log(`📋 發現 ${allActiveProjects.length} 個需要恢復的專案`);

      for (const savedProject of allActiveProjects) {
        try {
          if (savedProject.state === 'active') {
            console.log(`🔄 恢復專案: ${savedProject.projectId} (callFlowId: ${savedProject.callFlowId})`);

            const projectInstance = await Project.initOutboundProject({
              projectId: savedProject.projectId,
              callFlowId: savedProject.callFlowId,
              client_id: savedProject.client_id,
              client_secret: savedProject.client_secret || '',
              recurrence: savedProject.recurrence,
              callRestriction: savedProject.callRestriction || []
            });

            activeProjects.set(savedProject.projectId, projectInstance);

            console.log(`🗑️ 清空專案 ${savedProject.projectId} 的舊撥號名單...`);
            const clearResult = await CallListManager.removeProjectCallList(savedProject.projectId);
            if (clearResult) {
              console.log(`✅ 專案 ${savedProject.projectId} 舊撥號名單已清空`);
            } else {
              console.warn(`⚠️ 專案 ${savedProject.projectId} 清空撥號名單失敗，但不影響恢復流程`);
            }

            projectInstance.setBroadcastWebSocket(mainWebSocketServer);
            projectInstance.setOnCompleteStop(() => activeProjects.delete(savedProject.projectId));
            await projectInstance.create3cxWebSocketConnection(mainWebSocketServer);

            console.log(`✅ 專案 ${savedProject.projectId} 恢復成功，代理數量: ${savedProject.agentQuantity}`);
          } else {
            console.log(`⏭️ 跳過非活躍專案: ${savedProject.projectId} (狀態: ${savedProject.state})`);
          }
        } catch (error) {
          console.error(`恢復專案 ${savedProject.projectId} 失敗:`, error);
        }
      }

      console.log(`🎉 專案恢復完成，成功恢復 ${activeProjects.size} 個專案`);
      await broadcastAllProjects(mainWebSocketServer);

    } else {
      console.log('⏸️ 自動恢復功能未啟用，跳過專案恢復');

      const clearAllResult = await CallListManager.clearAllProjectCallList();
      if (clearAllResult.success) {
        console.log(`✅ 成功清空所有專案的舊撥號名單 (共 ${clearAllResult.clearedProjects} 個專案，${clearAllResult.totalRecords} 筆記錄)`);
      } else {
        console.warn(`⚠️ 清空所有專案的舊撥號名單失敗，但不影響恢復流程`);
      }

      await ProjectManager.clearAllProjects();
      console.log(`✅ 成功清空所有專案緩存`);
    }
  } catch (error) {
    console.error('恢復活躍專案時發生錯誤:', error);
    // 恢復失敗不應阻止服務器啟動
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 語音通知 (Call Schedule)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 動態載入並初始化語音通知功能。
 *
 * 完成以下工作：
 * 1. 動態載入所有 call-schedule 模組
 * 2. 將實際路由填入 placeholder router
 * 3. 初始化 SQLite 資料庫
 * 4. 初始化電話設備（失敗時僅 log，不中斷啟動）
 * 5. 恢復重啟前未執行的排程任務
 * 6. 啟動通話狀態監控（失敗時僅 log，不中斷啟動）
 * 7. 啟動 FIAS TCP 伺服器
 */
async function setupCallSchedule(): Promise<void> {
  const [
    { default: callScheduleRouter },
    { default: lakeshoreRouter },
    { initDatabase },
    { startCallMonitorServer },
    { recoverPendingSchedules },
    { phoneApiService },
    { default: fiasHandler },
    { createServer: createFiasServer },
    { connectToPms },
    { setFiasConn },
    { LakeshoreCallResultHandler },
    { registerCallResultHandler },
  ] = await Promise.all([
    import('./features/call-schedule/routes/callSchedule'),
    import('./features/call-schedule/routes/lakeshore'),
    import('./features/call-schedule/services/database'),
    import('./features/call-schedule/services/callMonitorService'),
    import('./features/call-schedule/services/callScheduleService'),
    import('./features/call-schedule/services/api/phoneApiService'),
    import('./features/call-schedule/components/fiasHandler'),
    import('./features/call-schedule/util/fias'),
    import('./features/call-schedule/util/fiasClient'),
    import('./features/call-schedule/util/fiasConnectionStore'),
    import('./features/call-schedule/components/lakeshoreCallResultHandler'),
    import('./features/call-schedule/services/monitor/callResultNotifier'),
  ]);

  // ── 路由填入 placeholder ──────────────────────────────────────────────────
  callScheduleRouter_!.use('/', callScheduleRouter);
  lakeshoreRouter_!.use('/', lakeshoreRouter);

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
    startCallMonitorServer(callScheduleRouter_!);
  } catch (error) {
    console.error('❌ [CallSchedule] 通話監控啟動失敗:', error);
  }

  // ── 通話結果 Handler 註冊 ─────────────────────────────────────────────────
  // 新增飯店：實作 ICallResultHandler（參考 lakeshoreCallResultHandler.ts），在這裡 register 即可
  registerCallResultHandler(new LakeshoreCallResultHandler());

  // ── FIAS TCP ──────────────────────────────────────────────────────────────
  // ENABLE_FIAS=false → 跳過，不佔用 TCP port（適合 Cloud Run 等單 port 環境）
  // FIAS_MODE=server（預設）：開 TCP server，等 PMS 連入
  // FIAS_MODE=client        ：主動連至 PMS TCP server（煙波等 PMS SERVER 模式）
  if (!ENABLE_FIAS) {
    console.log('📡 FIAS 已停用（ENABLE_FIAS=false），跳過 TCP 初始化');
  } else {
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

/**
 * 啟動順序：
 * 1. 動態載入自動外播模組並初始化（含 Redis、WebSocket 設定、專案恢復）
 * 2. 初始化語音通知的資料儲存與背景服務
 * 3. 印出啟動資訊
 */
httpServer.listen(PORT, async () => {
  try {
    if (ENABLE_OUTBOUND_CAMPAIGN) {
      await setupOutboundCampaign();
    }

    if (ENABLE_CALL_SCHEDULE) {
      await setupCallSchedule();
    }

    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`⚡️ 自動外播: ${ENABLE_OUTBOUND_CAMPAIGN ? '啟用' : '停用'}`);
    console.log(`⚡️ 語音通知: ${ENABLE_CALL_SCHEDULE ? '啟用' : '停用'}`);
    if (ENABLE_OUTBOUND_CAMPAIGN) {
      console.log(`🔌 WebSocket server is running on port ${PORT}`);
      console.log(`🖥️ Bonsale WebHook WebSocket is available on port ${PORT}/api/bonsale/webhook-ws`);
    }
    console.log(`ℹ️ Version: v2.0.6`);

  } catch (error) {
    console.error('啟動服務器失敗:', error);
    process.exit(1);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 優雅關閉
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 優雅關閉處理
 *
 * 收到作業系統終止信號後，先釋放資源再退出，避免強制中斷造成資料損毀：
 *   SIGINT  : 終端 Ctrl+C（開發環境常用）
 *   SIGTERM : Docker / Kubernetes 發送的正常關閉指令
 *
 * 退出碼：
 *   0 → 正常關閉
 *   1 → 關閉過程發生錯誤（讓容器管理系統知道有異常）
 */
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`收到 ${signal} 信號，正在關閉服務器...`);
  try {
    if (outboundCloseRedis) {
      await outboundCloseRedis();
    }
    process.exit(0);
  } catch (error) {
    console.error('關閉服務器失敗:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// 捕獲所有未處理的 Promise rejection，避免 Node.js 15+ 預設直接終止進程
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Promise Rejection:', { reason, promise });
});

export default app;
