import express, { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { formatInTimeZone } from 'date-fns-tz';
import { getDatabase } from '../services/database';
import { getBonsaleCompanySys } from '../services/api/bonsale';
import schedule from 'node-schedule'
import { mackeCall } from '@/services/api/newRockApi';
import { registerCall, cancelScheduleJobs } from '../services/callMonitorService';
const router: Router = express.Router();

interface DbRow {
  id: string;
  audioFile: string;
  date: string;
  extension: string;
  callStatus: string;
  callRecord: string | null;
  notes: string | null;
  notificationContent: string;
  retryInterval: string;
  maxRetries: string;
  createdAt: string;
}

function rowToRecord(row: DbRow, timezone = 'UTC') {
  const localDate = formatInTimeZone(new Date(row.date), timezone, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx");
  return {
    id: row.id,
    audioFile: row.audioFile,
    date: localDate,
    extension: row.extension,
    callStatus: row.callStatus,
    callRecord: row.callRecord ?? undefined,
    notes: row.notes ?? undefined,
    notificationContent: row.notificationContent,
    retryInterval: row.retryInterval,
    maxRetries: row.maxRetries,
    createdAt: row.createdAt,
  };
}

const UTC_ISO_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function validateUtcDate(date: string): boolean {
  return UTC_ISO_REGEX.test(date) && !isNaN(new Date(date).getTime());
}

const SORTABLE_FIELDS: Record<string, string> = {
  date: 'date',
  createdAt: 'createdAt',
  extension: 'extension',
  callStatus: 'callStatus',
};

// GET /api/call-schedule
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      startDate, endDate, status, extension,
      page = '1', limit = '10',
      sort = 'createdAt', order = 'desc',
    } = req.query;

    const sortField = SORTABLE_FIELDS[sort as string] ?? 'createdAt';
    const sortOrder = (order as string).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    
    let whereClause = 'WHERE 1=1';
    const params: (string | number)[] = [];

    if (startDate) {
      whereClause += ' AND date >= ?';
      params.push(startDate as string);
    }
    if (endDate) {
      whereClause += ' AND date <= ?';
      params.push(endDate as string);
    }
    if (status) {
      const statusList = (status as string).split(',').map(s => s.trim()).filter(Boolean);
      if (statusList.length > 0) {
        whereClause += ` AND callStatus IN (${statusList.map(() => '?').join(',')})`;
        params.push(...statusList);
      }
    }
    if (extension) {
      whereClause += ' AND extension LIKE ?';
      params.push(`%${extension as string}%`);
    }



    const countParams = [...params];
    const countResult = db.prepare(`SELECT COUNT(*) as count FROM call_schedules ${whereClause}`).get(...countParams) as { count: number };
    const total = countResult.count;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit as string, 10) || 10);
    params.push(limitNum, (pageNum - 1) * limitNum);

    const rows = db.prepare(
      `SELECT * FROM call_schedules ${whereClause} ORDER BY ${sortField} ${sortOrder} LIMIT ? OFFSET ?`
    ).all(...params) as DbRow[];

    const bonsaleCompanySys = await getBonsaleCompanySys();
    const timezone = bonsaleCompanySys?.data?.timezoneIANA ?? 'UTC';

    res.json({ success: true, data: rows.map(row => rowToRecord(row, timezone)), total });
  } catch (error) {
    console.error('[CallSchedule] GET error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /api/call-schedule/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { id } = req.params;
    const row = db.prepare('SELECT * FROM call_schedules WHERE id = ?').get(id) as DbRow | undefined;
    if (!row) {
      res.status(404).json({ success: false, message: 'Not found' });
      return;
    }
    const bonsaleCompanySys = await getBonsaleCompanySys();
    const timezone = bonsaleCompanySys?.data?.timezoneIANA ?? 'UTC';
    res.json({ success: true, data: rowToRecord(row, timezone) });
  } catch (error) {
    console.error('[CallSchedule] GET /:id error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// POST /api/call-schedule
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { audioFile, date, extension, notificationContent, retryInterval, maxRetries = '3', notes = '' } = req.body;

    if (!audioFile || !date || !extension || !notificationContent || !retryInterval) {
      res.status(400).json({ success: false, message: 'Missing required fields' });
      return;
    }

    if (!validateUtcDate(date)) {
      res.status(400).json({ success: false, message: 'date must be a valid UTC ISO 8601 string (e.g. 2026-03-06T06:00:00.000Z)' });
      return;
    }

    const newId = randomUUID();
    const createdAt = new Date().toISOString();

    // 1. 先存放資料庫
    db.prepare(`
      INSERT INTO call_schedules
        (id, audioFile, date, extension, callStatus, callRecord, notes, notificationContent, retryInterval, maxRetries, createdAt)
      VALUES (?, ?, ?, ?, '排程中', NULL, ?, ?, ?, ?, ?)
    `).run(newId, audioFile, date, extension, notes, notificationContent, retryInterval, maxRetries, createdAt);

    // 2. 再針對資料進行排程
    const jobDate = new Date(date);
    const maxRetriesNum = Math.max(0, parseInt(maxRetries as string, 10) || 0);
    const retryIntervalMs = Math.max(0, parseFloat(retryInterval as string) || 0) * 60 * 1000;
    // 撥打方（主叫）分機：優先使用環境變數，否則預設 '9038'
    const FROM_EXTENSION = process.env.OM_CALL_FROM_EXTENSION ?? '9038';
    console.log(`[CallSchedule] Scheduling job for ID: ${newId} at ${jobDate.toISOString()}`);
    schedule.scheduleJob(newId, jobDate, async () => {
      console.log(`[CallSchedule] Executing scheduled job for ID: ${newId} at ${new Date().toISOString()}`);
      try {
        // 撥打電話
        const toCall = await mackeCall(FROM_EXTENSION, extension);
        if (!toCall.success) {
          console.error(`[CallSchedule] Call failed for ID: ${newId}`, toCall.error);
          db.prepare(`UPDATE call_schedules SET callStatus = '錯誤' WHERE id = ?`).run(newId);
          return;
        }
        console.log(`[CallSchedule] Call initiated for ID: ${newId}, monitoring answer state...`);
        db.prepare(`UPDATE call_schedules SET callStatus = '撥打中' WHERE id = ?`).run(newId);
        // 向 OM 監控服務登記此通話，由其負責後續重試與狀態更新
        registerCall({
          scheduleId: newId,
          extension,
          from: FROM_EXTENSION,
          maxRetries: maxRetriesNum,
          retryIntervalMs,
        });
      } catch (err) {
        console.error(`[CallSchedule] Failed to execute scheduled call for ID: ${newId}`, err);
        db.prepare(`UPDATE call_schedules SET callStatus = '錯誤' WHERE id = ?`).run(newId);
      }
    });

    res.json({ success: true, data: { id: newId } });
  } catch (error) {
    console.error('[CallSchedule] POST error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// PUT /api/call-schedule/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDatabase();
    const { audioFile, date, extension, callRecord, notes, notificationContent, retryInterval, maxRetries } = req.body;

    if (date !== undefined && date !== null && !validateUtcDate(date)) {
      res.status(400).json({ success: false, message: 'date must be a valid UTC ISO 8601 string (e.g. 2026-03-06T06:00:00.000Z)' });
      return;
    }

    // 1. 先更新資料庫
    db.prepare(`
      UPDATE call_schedules SET
        audioFile           = COALESCE(?, audioFile),
        date                 = COALESCE(?, date),
        extension            = COALESCE(?, extension),
        callStatus          = '排程中',
        callRecord          = COALESCE(?, callRecord),
        notes                = COALESCE(?, notes),
        notificationContent = COALESCE(?, notificationContent),
        retryInterval       = COALESCE(?, retryInterval),
        maxRetries          = COALESCE(?, maxRetries)
      WHERE id = ?
    `).run(
      audioFile ?? null,
      date ?? null,
      extension ?? null,
      callRecord ?? null,
      notes ?? null,
      notificationContent ?? null,
      retryInterval ?? null,
      maxRetries ?? null,
      id
    );

    // 2. 取消舊排程（含所有可能存在的 retry job），用更新後的 date 重新安排
    cancelScheduleJobs(id, schedule.scheduledJobs);
    const updatedRow = db.prepare(
      'SELECT date, extension, retryInterval, maxRetries FROM call_schedules WHERE id = ?'
    ).get(id) as { date: string; extension: string; retryInterval: string; maxRetries: string } | undefined;
    if (updatedRow) {
      const jobDate = new Date(updatedRow.date);
      const updatedExtension = extension ?? updatedRow.extension;
      const updatedMaxRetries = Math.max(0, parseInt(maxRetries ?? updatedRow.maxRetries, 10) || 0);
      const updatedRetryIntervalMs =
        Math.max(0, parseFloat(retryInterval ?? updatedRow.retryInterval) || 0) * 60 * 1000;
      const fromExtension = process.env.OM_CALL_FROM_EXTENSION ?? '9038';
      console.log(`[CallSchedule] Rescheduling job for ID: ${id} at ${jobDate.toISOString()}`);
      schedule.scheduleJob(id, jobDate, async () => {
        console.log(`[CallSchedule] Executing rescheduled job for ID: ${id} at ${new Date().toISOString()}`);
        try {
          const toCall = await mackeCall(fromExtension, updatedExtension);
          if (!toCall.success) {
            console.error(`[CallSchedule] Call failed for ID: ${id}`, toCall.error);
            db.prepare(`UPDATE call_schedules SET callStatus = '錯誤' WHERE id = ?`).run(id);
            return;
          }
          console.log(`[CallSchedule] Call initiated for ID: ${id}, monitoring answer state...`);
          db.prepare(`UPDATE call_schedules SET callStatus = '撥打中' WHERE id = ?`).run(id);
          registerCall({
            scheduleId: id,
            extension: updatedExtension,
            from: fromExtension,
            maxRetries: updatedMaxRetries,
            retryIntervalMs: updatedRetryIntervalMs,
          });
        } catch (err) {
          console.error(`[CallSchedule] Failed to execute rescheduled call for ID: ${id}`, err);
          db.prepare(`UPDATE call_schedules SET callStatus = '錯誤' WHERE id = ?`).run(id);
        }
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[CallSchedule] PUT error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// DELETE /api/call-schedule/:id
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { id } = req.params;
    db.prepare('DELETE FROM call_schedules WHERE id = ?').run(id);
    cancelScheduleJobs(id, schedule.scheduledJobs);
    res.json({ success: true });
  } catch (error) {
    console.error('[CallSchedule] DELETE error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
