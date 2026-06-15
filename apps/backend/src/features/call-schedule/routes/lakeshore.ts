import express, { Router, Request, Response } from 'express';
// import { triggerImmediateCall } from '../services/callScheduleService';

const router: Router = express.Router();

// POST /api/lakeshore/order
// Lakeshore Hotel 推送訂單，立即觸發撥打
router.post('/order', async (req: Request, res: Response) => {
  try {
    console.log('[Lakeshore] ===== Incoming Request =====');
    console.log('[Lakeshore] Headers:', JSON.stringify(req.headers, null, 2));
    console.log('[Lakeshore] Body:', JSON.stringify(req.body, null, 2));
    console.log('[Lakeshore] Query:', JSON.stringify(req.query, null, 2));
    console.log('[Lakeshore] ============================');
    // TODO: 認證驗證（API Key / IP 白名單）

    // TODO: 從 req.body 取出欄位（待確認 Lakeshore payload 格式）
    // const { audioFile, extension, notificationContent, retryInterval, maxRetries, notes, roomNum } = req.body;

    // const immediateCall = await triggerImmediateCall({
    //   audioFile,
    //   extension,
    //   notificationContent,
    //   retryInterval,
    //   maxRetries,
    //   notes,
    //   roomNum,
    // });
    // console.log('[Lakeshore] Immediate call triggered:', immediateCall);
    // TODO: 撥打完成後用 FIAS 格式回傳結果 
    // 這裡要透過 apps/backend/src/features/call-schedule/services/monitor/callResultNotifier.ts 
    // 來回傳結果給 Lakeshore（目前還沒實作 callResultNotifier 的 handler）

    res.json({ success: true });
  } catch (error) {
    console.error('[Lakeshore] POST /order error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
