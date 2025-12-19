import express, { Request, Response, Router } from 'express';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { query } from '../services/database';
import { randomUUID } from 'crypto';

const router: Router = express.Router();

/**
 * 將 ISO 8601 格式轉換為 MySQL DATETIME 格式
 * @param isoDate ISO 8601 格式字串 (e.g., '2025-12-25T07:30:00.000Z')
 * @returns MySQL DATETIME 格式 (e.g., '2025-12-25 07:30:00')
 */
const toMySQLDateTime = (isoDate: string): string => {
  return new Date(isoDate).toISOString().slice(0, 19).replace('T', ' ');
};

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
 * 取得通話排程列表 - 支援進階查詢
 *
 * Query Parameters:
 * - page: 頁碼 (預設: 1)
 * - limit: 每頁筆數 (預設: 10, 最大: 100)
 * - callStatus: 撥號狀態過濾 ('scheduling' | 'completed' | 'failed')
 * - extension: 分機號碼過濾 (模糊搜尋)
 * - dateFrom: 開始日期時間 (ISO 8601 格式)
 * - dateTo: 結束日期時間 (ISO 8601 格式)
 * - audioFile: 鈴聲檔案過濾 (模糊搜尋)
 * - notificationContent: 通知內容過濾 (模糊搜尋)
 * - sortBy: 排序欄位 (date | createdAt | updatedAt, 預設: date)
 * - sortOrder: 排序方向 (ASC | DESC, 預設: DESC)
 * - search: 全文搜尋 (搜尋 extension, notes, notificationContent)
 */
router.get('/', async function (req: Request, res: Response) {
  try {
    // 解析查詢參數
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));
    const offset = (page - 1) * limit;

    const {
      callStatus,
      extension,
      dateFrom,
      dateTo,
      audioFile,
      notificationContent,
      search,
      sortBy = 'date',
      sortOrder = 'DESC',
    } = req.query;

    // 建立 WHERE 條件
    const conditions: string[] = [];
    const params: unknown[] = [];

    // 撥號狀態過濾
    if (callStatus && ['scheduling', 'completed', 'failed'].includes(callStatus as string)) {
      conditions.push('call_status = ?');
      params.push(callStatus);
    }

    // 分機號碼過濾 (模糊搜尋)
    if (extension) {
      conditions.push('extension LIKE ?');
      params.push(`%${extension}%`);
    }

    // 日期範圍過濾
    if (dateFrom) {
      conditions.push('date >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push('date <= ?');
      params.push(dateTo);
    }

    // 鈴聲檔案過濾
    if (audioFile) {
      conditions.push('audio_file LIKE ?');
      params.push(`%${audioFile}%`);
    }

    // 通知內容過濾
    if (notificationContent) {
      conditions.push('notification_content LIKE ?');
      params.push(`%${notificationContent}%`);
    }

    // 全文搜尋
    if (search) {
      conditions.push('(extension LIKE ? OR notes LIKE ? OR notification_content LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 驗證排序欄位
    const validSortFields = ['date', 'created_at', 'updated_at', 'call_status'];
    const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'date';
    const sortDirection = (sortOrder as string)?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // 查詢總筆數
    const countSql = `SELECT COUNT(*) as total FROM call_schedules ${whereClause}`;
    const countResult = await query<RowDataPacket[]>(countSql, params);
    const totalRecords = countResult[0].total;

    // 查詢資料
    const dataSql = `
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
      ${whereClause}
      ORDER BY ${sortField} ${sortDirection}
      LIMIT ? OFFSET ?
    `;
    const dataParams = [...params, limit, offset];
    const rows = await query<RowDataPacket[]>(dataSql, dataParams);

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total: totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    return handleError(error, 'GET /api/call-schedule', res);
  }
});

/**
 * GET /api/call-schedule/:id
 * 取得單一通話排程
 */
router.get('/:id', async function (req: Request, res: Response) {
  try {
    const { id } = req.params;

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
      WHERE id = ?
    `;
    const rows = await query<RowDataPacket[]>(sql, [id]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Call schedule not found',
        timestamp: new Date().toISOString(),
      });
    }

    return res.status(200).json({
      success: true,
      data: rows[0],
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    return handleError(error, 'GET /api/call-schedule/:id', res);
  }
});

/**
 * POST /api/call-schedule
 * 新增通話排程
 *
 * Request Body:
 * {
 *   "audioFile": "預設鈴聲",
 *   "date": "2025-12-25T07:30:00.000Z",
 *   "extension": "A館 10F - 1002",
 *   "callStatus": "scheduling",  // 可選，預設 "scheduling"
 *   "callRecord": "-",            // 可選
 *   "notes": "",                  // 可選
 *   "notificationContent": "標準叫醒服務",
 *   "retryInterval": 5
 * }
 */
router.post('/', async function (req: Request, res: Response) {
  try {
    const {
      audioFile,
      date,
      extension,
      callStatus = 'scheduling',
      callRecord = '-',
      notes = '',
      notificationContent,
      retryInterval,
    } = req.body;

    // 驗證必填欄位
    if (!audioFile || !date || !extension || !notificationContent || retryInterval === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: audioFile, date, extension, notificationContent, retryInterval',
        timestamp: new Date().toISOString(),
      });
    }

    // 驗證 callStatus
    if (!['scheduling', 'completed', 'failed'].includes(callStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid callStatus. Must be one of: scheduling, completed, failed',
        timestamp: new Date().toISOString(),
      });
    }

    // 驗證日期格式
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Use ISO 8601 format (e.g., 2025-12-25T07:30:00.000Z)',
        timestamp: new Date().toISOString(),
      });
    }

    // 轉換為 MySQL DATETIME 格式
    const mysqlDate = toMySQLDateTime(date);

    const id = randomUUID();
    const sql = `
      INSERT INTO call_schedules
        (id, audio_file, date, extension, call_status, call_record, notes, notification_content, retry_interval)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [id, audioFile, mysqlDate, extension, callStatus, callRecord, notes, notificationContent, retryInterval];

    await query<ResultSetHeader>(sql, params);

    // 查詢剛新增的資料
    const selectSql = `
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
      WHERE id = ?
    `;
    const newRecord = await query<RowDataPacket[]>(selectSql, [id]);

    return res.status(201).json({
      success: true,
      message: 'Call schedule created successfully',
      data: newRecord[0],
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    return handleError(error, 'POST /api/call-schedule', res);
  }
});

/**
 * PUT /api/call-schedule/:id
 * 更新通話排程（完整更新）
 *
 * Request Body: 與 POST 相同（需提供所有欄位）
 */
router.put('/:id', async function (req: Request, res: Response) {
  try {
    const { id } = req.params;
    const {
      audioFile,
      date,
      extension,
      callStatus,
      callRecord,
      notes,
      notificationContent,
      retryInterval,
    } = req.body;

    // 驗證必填欄位
    if (!audioFile || !date || !extension || !callStatus || !notificationContent || retryInterval === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        timestamp: new Date().toISOString(),
      });
    }

    // 驗證 callStatus
    if (!['scheduling', 'completed', 'failed'].includes(callStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid callStatus',
        timestamp: new Date().toISOString(),
      });
    }

    // 檢查記錄是否存在
    const checkSql = 'SELECT id FROM call_schedules WHERE id = ?';
    const existing = await query<RowDataPacket[]>(checkSql, [id]);
    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Call schedule not found',
        timestamp: new Date().toISOString(),
      });
    }

    // 轉換日期格式
    const mysqlDate = toMySQLDateTime(date);

    const sql = `
      UPDATE call_schedules
      SET
        audio_file = ?,
        date = ?,
        extension = ?,
        call_status = ?,
        call_record = ?,
        notes = ?,
        notification_content = ?,
        retry_interval = ?
      WHERE id = ?
    `;
    const params = [audioFile, mysqlDate, extension, callStatus, callRecord, notes, notificationContent, retryInterval, id];

    await query<ResultSetHeader>(sql, params);

    // 查詢更新後的資料
    const selectSql = `
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
      WHERE id = ?
    `;
    const updated = await query<RowDataPacket[]>(selectSql, [id]);

    return res.status(200).json({
      success: true,
      message: 'Call schedule updated successfully',
      data: updated[0],
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    return handleError(error, 'PUT /api/call-schedule/:id', res);
  }
});

/**
 * PATCH /api/call-schedule/:id
 * 部分更新通話排程
 *
 * Request Body: 只需提供要更新的欄位
 */
router.patch('/:id', async function (req: Request, res: Response) {
  try {
    const { id } = req.params;
    const {
      audioFile,
      date,
      extension,
      callStatus,
      callRecord,
      notes,
      notificationContent,
      retryInterval,
    } = req.body;

    // 檢查記錄是否存在
    const checkSql = 'SELECT id FROM call_schedules WHERE id = ?';
    const existing = await query<RowDataPacket[]>(checkSql, [id]);
    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Call schedule not found',
        timestamp: new Date().toISOString(),
      });
    }

    // 動態建立 UPDATE 語句
    const updates: string[] = [];
    const params: unknown[] = [];

    if (audioFile !== undefined) {
      updates.push('audio_file = ?');
      params.push(audioFile);
    }
    if (date !== undefined) {
      updates.push('date = ?');
      params.push(toMySQLDateTime(date));  // 轉換日期格式
    }
    if (extension !== undefined) {
      updates.push('extension = ?');
      params.push(extension);
    }
    if (callStatus !== undefined) {
      if (!['scheduling', 'completed', 'failed'].includes(callStatus)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid callStatus',
          timestamp: new Date().toISOString(),
        });
      }
      updates.push('call_status = ?');
      params.push(callStatus);
    }
    if (callRecord !== undefined) {
      updates.push('call_record = ?');
      params.push(callRecord);
    }
    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes);
    }
    if (notificationContent !== undefined) {
      updates.push('notification_content = ?');
      params.push(notificationContent);
    }
    if (retryInterval !== undefined) {
      updates.push('retry_interval = ?');
      params.push(retryInterval);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update',
        timestamp: new Date().toISOString(),
      });
    }

    params.push(id);
    const sql = `UPDATE call_schedules SET ${updates.join(', ')} WHERE id = ?`;

    await query<ResultSetHeader>(sql, params);

    // 查詢更新後的資料
    const selectSql = `
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
      WHERE id = ?
    `;
    const updated = await query<RowDataPacket[]>(selectSql, [id]);

    return res.status(200).json({
      success: true,
      message: 'Call schedule updated successfully',
      data: updated[0],
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    return handleError(error, 'PATCH /api/call-schedule/:id', res);
  }
});

/**
 * DELETE /api/call-schedule/:id
 * 刪除通話排程
 */
router.delete('/:id', async function (req: Request, res: Response) {
  try {
    const { id } = req.params;

    // 檢查記錄是否存在
    const checkSql = 'SELECT id FROM call_schedules WHERE id = ?';
    const existing = await query<RowDataPacket[]>(checkSql, [id]);
    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Call schedule not found',
        timestamp: new Date().toISOString(),
      });
    }

    const sql = 'DELETE FROM call_schedules WHERE id = ?';
    await query<ResultSetHeader>(sql, [id]);

    return res.status(200).json({
      success: true,
      message: 'Call schedule deleted successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    return handleError(error, 'DELETE /api/call-schedule/:id', res);
  }
});

export { router };
