import express, { Router, Request, Response } from 'express';
const router: Router = express.Router();

// GET /api/config/auth
router.get('/auth', (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        OutboundCampaign: process.env.ENABLE_OUTBOUND_CAMPAIGN === 'true',
        CallSchedule: process.env.ENABLE_CALL_SCHEDULE === 'true'
      }
    });
  } catch (error) {
    console.error('[Auth] GET /auth error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
