import express, { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { formatInTimeZone } from 'date-fns-tz';
import { getDatabase } from '../services/database';
import { getBonsaleCompanySys } from '../services/api/bonsale';

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
    db.prepare(`
      INSERT INTO call_schedules
        (id, audioFile, date, extension, callStatus, callRecord, notes, notificationContent, retryInterval, maxRetries, createdAt)
      VALUES (?, ?, ?, ?, '排程中', NULL, ?, ?, ?, ?, ?)
    `).run(newId, audioFile, date, extension, notes, notificationContent, retryInterval, maxRetries, createdAt);

    res.json({ success: true, data: { id: newId } });
  } catch (error) {
    console.error('[CallSchedule] POST error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// PUT /api/call-schedule/:id
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { id } = req.params;
    const { audioFile, date, extension, callStatus, callRecord, notes, notificationContent, retryInterval, maxRetries } = req.body;

    if (date !== undefined && date !== null && !validateUtcDate(date)) {
      res.status(400).json({ success: false, message: 'date must be a valid UTC ISO 8601 string (e.g. 2026-03-06T06:00:00.000Z)' });
      return;
    }

    db.prepare(`
      UPDATE call_schedules SET
        audioFile           = COALESCE(?, audioFile),
        date                 = COALESCE(?, date),
        extension            = COALESCE(?, extension),
        callStatus          = COALESCE(?, callStatus),
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
      callStatus ?? null,
      callRecord ?? null,
      notes ?? null,
      notificationContent ?? null,
      retryInterval ?? null,
      maxRetries ?? null,
      id
    );

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
    res.json({ success: true });
  } catch (error) {
    console.error('[CallSchedule] DELETE error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
