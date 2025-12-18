import express, { Request, Response, Router } from 'express';
import { RowDataPacket } from 'mysql2';
import { query } from '../services/database';

const router: Router = express.Router();

// Error handler helper function
const handleError = (error: unknown, operation: string, res: Response) => {
  console.error(`Error in ${operation}:`, error instanceof Error ? error.message : String(error));
  const status = error instanceof Error && 'status' in error ? (error as { status: number }).status : 500;
  const message = error instanceof Error ? error.message : String(error);
  return res.status(status).json({
    success: false,
    message: `Error in ${operation}`,
    error: message,
    timestamp: new Date().toISOString(),
  });
};

/**
 * GET /api/call-schedule
 * 測試 API - 取得所有通話排程
 */
router.get('/', async function (req: Request, res: Response) {
  try {
    // 簡單查詢所有資料
    const sql = `
      SELECT
        id,
        audio_file as audioFile,
        DATE_FORMAT(date, '%Y/%m/%d %H:%i') as date,
        extension,
        call_status as callStatus,
        call_record as callRecord,
        notes,
        notification_content as notificationContent,
        retry_interval as retryInterval,
        created_at as createdAt,
        updated_at as updatedAt
      FROM call_schedules
      ORDER BY date DESC
      LIMIT 10
    `;
    const rows = await query<RowDataPacket[]>(sql);

    return res.status(200).json({
      success: true,
      data: rows,
      total: rows.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    return handleError(error, 'GET /api/call-schedule', res);
  }
});

export { router };
