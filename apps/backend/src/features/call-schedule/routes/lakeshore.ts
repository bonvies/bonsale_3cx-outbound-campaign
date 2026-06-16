import express, { Router, Request, Response } from 'express';
import { triggerImmediateCall } from '../services/callScheduleService';

const router: Router = express.Router();

// POST /api/lakeshore/order
// Lakeshore Hotel 推送訂單，立即觸發撥打；結果透過 FIAS TCP 連線非同步回傳 PMS
router.post('/order', async (req: Request, res: Response) => {
  try {
    console.log('[Lakeshore] ===== Incoming Request =====');
    console.log('[Lakeshore] Headers:', JSON.stringify(req.headers, null, 2));
    console.log('[Lakeshore] Body:', JSON.stringify(req.body, null, 2));
    console.log('[Lakeshore] Query:', JSON.stringify(req.query, null, 2));
    console.log('[Lakeshore] ============================');

    // TODO: 確認 Lakeshore 實際欄位名稱後對應到這裡
    const { audioFile, extension, notificationContent, retryInterval, maxRetries, notes, roomNum } = req.body;

    const scheduleId = await triggerImmediateCall({
      audioFile: audioFile ?? '',
      extension,
      notificationContent: notificationContent ?? '',
      retryInterval: retryInterval ?? '5',
      maxRetries: maxRetries ?? '3',
      notes,
      roomNum,
    });

    console.log(`[Lakeshore] 立即撥打已觸發 scheduleId=${scheduleId}`);
    res.json({ success: true, scheduleId });
  } catch (error) {
    console.error('[Lakeshore] POST /order error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
