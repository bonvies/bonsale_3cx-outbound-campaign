import express, { Router, Request, Response } from 'express';
import { getBonsaleCompanySys } from '../services/api/bonsale';

const router: Router = express.Router();

// 無條件掛載，不受 ENABLE_OUTBOUND_CAMPAIGN / ENABLE_CALL_SCHEDULE 影響
// 前端無論啟用哪個功能都需要此端點取得 timezoneIANA
router.get('/company', async (_req: Request, res: Response) => {
  if (process.env.SITE_TIMEZONE) {
    return res.status(200).json({ timezoneIANA: process.env.SITE_TIMEZONE });
  }
  try {
    const result = await getBonsaleCompanySys();
    return res.status(200).json(result.data ?? {});
  } catch (error) {
    console.error('[Bonsale] GET /company error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
