import express, { Router, Request, Response } from 'express';
import { getSiteTimezone } from '@call-schedule/util/timezone';

const router: Router = express.Router();

// GET /api/config/timezone
// 前端顯示排程時間時，以站點時區（SITE_TIMEZONE）換算
router.get('/timezone', (_req: Request, res: Response) => {
  res.json({ success: true, data: { timezoneIANA: getSiteTimezone() } });
});

export default router;
