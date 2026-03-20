import express, { Request, Response, Router } from 'express';
import { WebSocketServer } from 'ws';
import Project from '../class/project';
import { ProjectManager } from '../class/projectManager';
import { logWithTimestamp, warnWithTimestamp, errorWithTimestamp } from '../../../shared/util/timestamp';

/**
 * 建立外播控制 HTTP API 路由
 *
 * 提供等同於 WebSocket startOutbound / stopOutbound 的 REST API，
 * 讓外部系統（非前端儀表板）也能透過 HTTP 觸發外播操作。
 *
 * @param activeProjects - 活躍外播專案的實例映射表（與 app.ts 共享）
 * @param mainWebSocketServer - 主要 WebSocket 服務器（廣播狀態給前端）
 */
export function createOutboundRouter(
  activeProjects: Map<string, Project>,
  mainWebSocketServer: WebSocketServer
): Router {
  const router: Router = express.Router();

  /**
   * POST /api/outbound/start
   *
   * 啟動外播專案。等同於前端發送 startOutbound WebSocket 事件。
   *
   * Request body:
   * {
   *   "callFlowId": "string",
   *   "projectId": "string",
   *   "client_id": "string",
   *   "client_secret": "string",
   *   "recurrence": "string | null",       // 選填
   *   "callRestriction": []                 // 選填
   * }
   *
   * Response:
   *   200 { success: true, projectId: string }
   *   400 缺少必填欄位
   *   409 專案已在運行中
   *   500 啟動失敗
   */
  router.post('/start', async (req: Request, res: Response) => {
    const project = req.body;

    if (!project.callFlowId || !project.projectId || !project.client_id || !project.client_secret) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: callFlowId, projectId, client_id, client_secret'
      });
    }

    if (activeProjects.has(project.projectId)) {
      return res.status(409).json({
        success: false,
        message: `Project ${project.projectId} is already running`
      });
    }

    try {
      logWithTimestamp(`[HTTP API] 啟動外播專案: ${project.projectId}`);
      const projectInstance = await Project.initOutboundProject(project);
      activeProjects.set(project.projectId, projectInstance);
      projectInstance.setBroadcastWebSocket(mainWebSocketServer);
      await projectInstance.create3cxWebSocketConnection(mainWebSocketServer);

      return res.status(200).json({ success: true, projectId: project.projectId });
    } catch (error) {
      errorWithTimestamp(`[HTTP API] 啟動外播專案 ${project.projectId} 失敗:`, error);
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * POST /api/outbound/stop
   *
   * 停止外播專案。等同於前端發送 stopOutbound WebSocket 事件。
   *
   * Request body:
   * {
   *   "projectId": "string"
   * }
   *
   * Response:
   *   200 { success: true, projectId: string }
   *   400 缺少必填欄位
   *   404 專案不存在
   *   500 停止失敗
   */
  router.post('/stop', async (req: Request, res: Response) => {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: projectId'
      });
    }

    if (!activeProjects.has(projectId)) {
      return res.status(404).json({
        success: false,
        message: `Project ${projectId} is not running`
      });
    }

    try {
      logWithTimestamp(`[HTTP API] 停止外播專案: ${projectId}`);
      const stopSuccess = await Project.stopOutboundProject({ projectId }, activeProjects, mainWebSocketServer);
      if (!stopSuccess) {
        warnWithTimestamp(`[HTTP API] 停止專案 ${projectId} 失敗`);
        return res.status(500).json({ success: false, message: `Failed to stop project ${projectId}` });
      }

      return res.status(200).json({ success: true, projectId });
    } catch (error) {
      errorWithTimestamp(`[HTTP API] 停止外播專案 ${projectId} 失敗:`, error);
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * GET /api/outbound/projects
   *
   * 取得所有外播專案狀態（從 Redis）。
   *
   * Response:
   *   200 { success: true, data: ProjectData[] }
   */
  router.get('/projects', async (_req: Request, res: Response) => {
    try {
      const projects = await ProjectManager.getAllActiveProjects();
      return res.status(200).json({ success: true, data: projects });
    } catch (error) {
      errorWithTimestamp('[HTTP API] 取得外播專案列表失敗:', error);
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  return router;
}
