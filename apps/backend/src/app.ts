// ─────────────────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer } from 'ws';

// 自動外播 (Outbound Campaign)
// - bonsaleRouter     : 提供 REST API 給前端操作外播專案（啟動、停止、查詢）
// - clientWsWebHook   : 接收 3CX 推送的通話事件（WebSocket Webhook）
// - initRedis/closeRedis : 啟動與關閉 Redis 連線（儲存外播專案狀態）
// - broadcastAllProjects : 廣播所有專案狀態給前端儀表板
// - broadcastError    : 廣播錯誤訊息給前端儀表板
// - ProjectManager    : 管理所有外播專案的生命週期（建立、停止、從 Redis 恢復）
// - CallListManager   : 管理各專案的撥號名單（Redis 中的通話佇列）
// - Project           : 單一外播專案的核心類別（3CX 連線、撥號、狀態追蹤）
import { router as bonsaleRouter, clientWsWebHook } from './routes/bonsale';
import { initRedis, closeRedis } from './services/redis';
import { broadcastAllProjects, broadcastError } from './components/broadcast';
import { ProjectManager } from './class/projectManager';
import { CallListManager } from './class/callListManager';
import Project from './class/project';

// 語音通知 (Morning Call)
// - callScheduleRouter    : 提供 REST API 管理語音通知排程（新增、查詢、刪除）
// - initDatabase          : 初始化 SQLite 資料庫（儲存排程設定）
// - startCallMonitorServer: 啟動 NewRock OM API 狀態監控（輪詢通話結果）
// - recoverPendingSchedules: 服務器重啟後，重新註冊尚未執行的排程任務
import callScheduleRouter from './routes/callSchedule';
import { initDatabase } from './services/database';
import { startCallMonitorServer } from './services/callMonitorService';
import { recoverPendingSchedules } from './services/callScheduleService';

// FIAS (Front desk Information and Administration System)
// - 接收飯店 PMS 系統透過 TCP 傳送的房客資訊，觸發語音通知撥號
// - fiasHandler    : 解析並處理 FIAS 訊息
// - createFiasServer: 建立 TCP 伺服器監聽 FIAS 連線
import fiasHandler from './components/fiasHandler';
import { createServer as createFiasServer } from './util/fias';

// 工具
import { logWithTimestamp, warnWithTimestamp, errorWithTimestamp } from './util/timestamp';

// ─────────────────────────────────────────────────────────────────────────────
// 環境設定 & Feature Flags
// ─────────────────────────────────────────────────────────────────────────────

dotenv.config();

/**
 * 功能開關
 *
 * 預設皆為 true（不設定環境變數 = 啟用）。
 * 若要停用某功能，在 .env 中設為 'false'：
 *   ENABLE_OUTBOUND_CAMPAIGN=false  → 停用自動外播（不連 Redis、不建 WebSocket）
 *   ENABLE_MORNING_CALL=false       → 停用語音通知（不建 SQLite、不啟動 FIAS TCP）
 */
const ENABLE_OUTBOUND_CAMPAIGN = process.env.ENABLE_OUTBOUND_CAMPAIGN !== 'false';
const ENABLE_MORNING_CALL      = process.env.ENABLE_MORNING_CALL      !== 'false';

const PORT      = process.env.HTTP_PORT || 4020; // HTTP / WebSocket 主服務埠
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

// 路由掛載（依功能開關決定是否啟用）
if (ENABLE_OUTBOUND_CAMPAIGN) {
  // 自動外播 API：/api/bonsale/*
  app.use('/api/bonsale', bonsaleRouter);
}
if (ENABLE_MORNING_CALL) {
  // 語音通知排程 API：/api/call-schedule/*
  app.use('/api/call-schedule', callScheduleRouter);
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

/**
 * WebSocket 升級請求分流
 *
 * HTTP Upgrade 請求進來時，根據路徑決定交給哪個 WebSocket Server 處理：
 *   /api/bonsale/WebHook → clientWsWebHook（接收 3CX 通話事件）
 *   其他路徑             → mainWebSocketServer（前端儀表板連線）
 *
 * 若自動外播功能停用，所有 WebSocket 升級請求一律拒絕（socket.destroy()）。
 */
httpServer.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;

  if (ENABLE_OUTBOUND_CAMPAIGN && pathname === '/api/bonsale/WebHook') {
    // 3CX 推送通話狀態的 Webhook WebSocket
    clientWsWebHook.handleUpgrade(request, socket, head, (websocket) => {
      clientWsWebHook.emit('connection', websocket, request);
    });
  } else if (ENABLE_OUTBOUND_CAMPAIGN) {
    // 前端儀表板的即時通訊 WebSocket
    mainWebSocketServer.handleUpgrade(request, socket, head, (websocket) => {
      mainWebSocketServer.emit('connection', websocket, request);
    });
  } else {
    // 自動外播功能停用時，拒絕所有 WebSocket 連線
    socket.destroy();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 自動外播 (Outbound Campaign)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 活躍外播專案的實例映射表
 *
 * key   : projectId（專案唯一識別碼）
 * value : Project 實例（持有 3CX WebSocket 連線與撥號狀態）
 *
 * 用途：前端發送 stopOutbound 事件時，從此 Map 取得實例並正確關閉連線。
 * 注意：此為記憶體狀態，服務器重啟後會清空，需透過 recoverActiveProjects() 重建。
 */
const activeProjects = new Map<string, Project>();

/**
 * 自動恢復之前的活躍外播專案
 *
 * 服務器重啟後，從 Redis 讀取上次的活躍專案清單，重新建立 Project 實例與
 * 3CX WebSocket 連線，讓外播得以從中斷點繼續進行。
 *
 * 行為取決於 AUTO_RECOVER_ON_RESTART 環境變數：
 *   true  → 逐一恢復 state==='active' 的專案（清空舊撥號名單後重新連線）
 *   false → 清空所有 Redis 中的專案狀態與撥號名單（全新啟動）
 *
 * 單一專案恢復失敗不會中斷整體恢復流程，確保其他專案仍可正常啟動。
 */
async function recoverActiveProjects(): Promise<void> {
  try {
    const autoRecover = process.env.AUTO_RECOVER_ON_RESTART;
    if (autoRecover === 'true') {
      logWithTimestamp({ isForce: true }, '🔄 檢查並恢復之前的活躍專案...');

      const allActiveProjects = await ProjectManager.getAllActiveProjects();

      if (allActiveProjects.length === 0) {
        logWithTimestamp({ isForce: true }, '📭 沒有發現需要恢復的專案');
        return;
      }

      logWithTimestamp({ isForce: true }, `📋 發現 ${allActiveProjects.length} 個需要恢復的專案`);

      for (const savedProject of allActiveProjects) {
        try {
          if (savedProject.state === 'active') {
            logWithTimestamp({ isForce: true }, `🔄 恢復專案: ${savedProject.projectId} (callFlowId: ${savedProject.callFlowId})`);

            // 重新建立 Project 實例（從 Redis 讀取的設定重新初始化）
            const projectInstance = await Project.initOutboundProject({
              projectId:       savedProject.projectId,
              callFlowId:      savedProject.callFlowId,
              client_id:       savedProject.client_id,
              client_secret:   savedProject.client_secret || '',
              recurrence:      savedProject.recurrence,
              callRestriction: savedProject.callRestriction || []
            });

            // 將恢復的實例加入活躍映射表
            activeProjects.set(savedProject.projectId, projectInstance);

            // 清空舊的撥號名單，避免重啟後重複撥打已撥過的號碼
            logWithTimestamp({ isForce: true }, `🗑️ 清空專案 ${savedProject.projectId} 的舊撥號名單...`);
            const clearResult = await CallListManager.removeProjectCallList(savedProject.projectId);
            if (clearResult) {
              logWithTimestamp({ isForce: true }, `✅ 專案 ${savedProject.projectId} 舊撥號名單已清空`);
            } else {
              warnWithTimestamp(`⚠️ 專案 ${savedProject.projectId} 清空撥號名單失敗，但不影響恢復流程`);
            }

            // 注入 WebSocket 廣播引用，讓 Project 可以主動推送狀態給前端
            projectInstance.setBroadcastWebSocket(mainWebSocketServer);

            // 重新建立與 3CX 的 WebSocket 連線，恢復通話監控
            await projectInstance.create3cxWebSocketConnection(mainWebSocketServer);

            logWithTimestamp({ isForce: true }, `✅ 專案 ${savedProject.projectId} 恢復成功，代理數量: ${savedProject.agentQuantity}`);
          } else {
            // 非 active 狀態（如 stopped）的專案不需要恢復
            logWithTimestamp(`⏭️ 跳過非活躍專案: ${savedProject.projectId} (狀態: ${savedProject.state})`);
          }
        } catch (error) {
          errorWithTimestamp(`恢復專案 ${savedProject.projectId} 失敗:`, error);
          // 單個專案失敗不中斷整體恢復流程
        }
      }

      logWithTimestamp({ isForce: true }, `🎉 專案恢復完成，成功恢復 ${activeProjects.size} 個專案`);

      // 恢復完成後，廣播最新的專案列表給所有已連線的前端
      await broadcastAllProjects(mainWebSocketServer);

    } else {
      // AUTO_RECOVER_ON_RESTART 未啟用，全新啟動：清空所有舊狀態
      logWithTimestamp({ isForce: true }, '⏸️ 自動恢復功能未啟用，跳過專案恢復');

      const clearAllResult = await CallListManager.clearAllProjectCallList();
      if (clearAllResult.success) {
        logWithTimestamp({ isForce: true }, `✅ 成功清空所有專案的舊撥號名單 (共 ${clearAllResult.clearedProjects} 個專案，${clearAllResult.totalRecords} 筆記錄)`);
      } else {
        warnWithTimestamp(`⚠️ 清空所有專案的舊撥號名單失敗，但不影響恢復流程`);
      }

      await ProjectManager.clearAllProjects();
      logWithTimestamp({ isForce: true }, `✅ 成功清空所有專案緩存`);
    }
  } catch (error) {
    errorWithTimestamp('恢復活躍專案時發生錯誤:', error);
    // 恢復失敗不應阻止服務器啟動
  }
}

/**
 * 前端儀表板 WebSocket 連線處理
 *
 * 每當前端建立 WebSocket 連線時：
 * 1. 立即推送當前所有專案狀態（讓前端載入後馬上看到最新資料）
 * 2. 啟動心跳機制（每 60 秒 ping 一次，確認連線仍存活）
 * 3. 監聽前端送來的操作事件（startOutbound / stopOutbound）
 *
 * 支援的事件：
 *   ping          → 回應 pong（前端自定義心跳）
 *   startOutbound → 初始化並啟動外播專案
 *   stopOutbound  → 停止指定外播專案
 */
if (ENABLE_OUTBOUND_CAMPAIGN) {
  mainWebSocketServer.on('connection', async (wsClient) => {
    logWithTimestamp('🔌 WebSocket client connected');

    // 新連線建立後，立即廣播當前所有專案狀態給該客戶端
    broadcastAllProjects(mainWebSocketServer);

    // ── 心跳機制 ────────────────────────────────────────────────────────────
    // 每 60 秒發送 ping；若 60 秒內未收到 pong，視為連線中斷並強制終止
    let isAlive = true;
    let heartbeatInterval: NodeJS.Timeout;

    const startHeartbeat = () => {
      heartbeatInterval = setInterval(() => {
        if (!isAlive) {
          logWithTimestamp('💔 WebSocket client ping 超時，終止連線');
          wsClient.terminate();
          return;
        }
        isAlive = false;
        wsClient.ping();
      }, 60000);
    };

    startHeartbeat();

    wsClient.on('pong', () => {
      // 收到 pong，重置存活旗標
      isAlive = true;
    });

    // ── 訊息處理 ────────────────────────────────────────────────────────────
    wsClient.on('message', async (message) => {
      try {
        const { event, payload } = JSON.parse(message.toString());

        switch (event) {
          // 前端發送的應用層心跳（與 WebSocket 原生 ping/pong 不同）
          case 'ping':
            wsClient.send(JSON.stringify({ event: 'pong', timestamp: Date.now() }));
            break;

          // 啟動外播專案：初始化 Project 實例並建立 3CX WebSocket 連線
          case 'startOutbound':
            console.log('Received startOutbound event with payload:', payload);
            const projectInstance = await Project.initOutboundProject(payload.project);
            activeProjects.set(payload.project.projectId, projectInstance);
            projectInstance.setBroadcastWebSocket(mainWebSocketServer);
            await projectInstance.create3cxWebSocketConnection(mainWebSocketServer);
            break;

          // 停止外播專案：關閉 3CX 連線並從 activeProjects 移除
          case 'stopOutbound':
            logWithTimestamp('停止 外撥事件:', payload.project);
            const stopSuccess = await Project.stopOutboundProject(payload.project, activeProjects, mainWebSocketServer);
            if (!stopSuccess) {
              warnWithTimestamp(`停止專案 ${payload.project.projectId} 失敗`);
            }
            break;

          default:
            warnWithTimestamp('未知事件:', event);
        }
      } catch (error) {
        errorWithTimestamp('WebSocket message handling error:', error);
        // 將錯誤廣播給所有連線的前端
        broadcastError(mainWebSocketServer, error);
      }
    });

    // ── 連線關閉 / 錯誤 ─────────────────────────────────────────────────────
    wsClient.on('close', () => {
      logWithTimestamp('👋 WebSocket client disconnected');
      clearInterval(heartbeatInterval);
    });

    wsClient.on('error', (error) => {
      errorWithTimestamp('WebSocket client error:', error);
      clearInterval(heartbeatInterval);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 啟動伺服器
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 啟動順序：
 * 1. 初始化各功能的資料儲存（Redis / SQLite）
 * 2. 啟動語音通知的背景服務（排程恢復 + OM 狀態監控）
 * 3. 印出啟動資訊
 * 4. 恢復重啟前的外播專案（若有啟用自動恢復）
 */
httpServer.listen(PORT, async () => {
  try {
    if (ENABLE_OUTBOUND_CAMPAIGN) { // 只有在自動外播功能啟用時才建立 Redis 連線
      // 建立 Redis 連線，用於儲存外播專案狀態與撥號名單
      await initRedis();
      logWithTimestamp({ isForce: true }, `🔴 Redis server is connected`);
    }

    if (ENABLE_MORNING_CALL) { // 只有在語音通知功能啟用時才初始化資料庫與啟動相關服務
      // 初始化 SQLite 資料庫，用於儲存語音通知排程設定
      await initDatabase();
      // 重新載入服務器重啟前尚未執行的排程任務
      recoverPendingSchedules();
      // 啟動輪詢 NewRock OM API 的背景監控，追蹤通話撥出結果
      startCallMonitorServer();
    }

    logWithTimestamp({ isForce: true }, `🚀 Server is running on port ${PORT}`);
    logWithTimestamp({ isForce: true }, `🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    logWithTimestamp({ isForce: true }, `⚡️ 自動外播: ${ENABLE_OUTBOUND_CAMPAIGN ? '啟用' : '停用'}`);
    logWithTimestamp({ isForce: true }, `⚡️ 語音通知: ${ENABLE_MORNING_CALL ? '啟用' : '停用'}`);
    if (ENABLE_OUTBOUND_CAMPAIGN) { // 只有在自動外播功能啟用時才顯示 WebSocket 相關資訊
      logWithTimestamp({ isForce: true }, `🔌 WebSocket server is running on port ${PORT}`);
      logWithTimestamp({ isForce: true }, `🖥️ Bonsale WebHook WebSocket is available on port ${PORT}/api/bonsale/webhook-ws`);
    }
    logWithTimestamp({ isForce: true }, `ℹ️ Version: v1.0.6`);

    if (ENABLE_OUTBOUND_CAMPAIGN) { // 只有在自動外播功能啟用時才從 Redis 恢復外播專案
      // 從 Redis 恢復上次服務器關閉前仍在執行的外播專案
      await recoverActiveProjects();
    }

  } catch (error) {
    errorWithTimestamp('啟動服務器失敗:', error);
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
  logWithTimestamp(`收到 ${signal} 信號，正在關閉服務器...`);
  try {
    if (ENABLE_OUTBOUND_CAMPAIGN) { // 只有在自動外播功能啟用時才關閉 Redis 連線
      // 正常關閉 Redis 連線，確保所有待寫入的資料都已儲存
      await closeRedis();
    }
    process.exit(0);
  } catch (error) {
    errorWithTimestamp('關閉服務器失敗:', error);
    process.exit(1);
  }
}

process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ─────────────────────────────────────────────────────────────────────────────
// FIAS TCP 伺服器（語音通知功能使用）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FIAS (Front desk Information and Administration System) TCP 伺服器
 *
 * 監聽飯店 PMS 系統透過 TCP 傳入的 FIAS 訊息（如房客 Check-in / Wake-up Call 請求）。
 * 收到訊息後交由 fiasHandler 解析並觸發對應的語音通知撥號。
 *
 * 僅在 ENABLE_MORNING_CALL=true 時啟動（語音通知功能的一部分）。
 * 監聽埠由 FIAS_PORT 環境變數控制，預設 4021。
 */
if (ENABLE_MORNING_CALL) { // 只有在語音通知功能啟用時才啟動 FIAS TCP 伺服器
  const fiasServer = createFiasServer(async (msg, conn) => {
    console.log('--- FIAS TCP 服務器收到訊息 ---');
    console.log('訊息內容:', msg);
    fiasHandler(msg, conn);
  });

  fiasServer.listen(FIAS_PORT, () => {
    logWithTimestamp({ isForce: true }, `📡 FIAS TCP server is running on port ${FIAS_PORT}`);
  });
}

export default app;
