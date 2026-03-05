import express, { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { getDatabase } from '../services/database';

const router: Router = express.Router();

interface DbRow {
  id: string;
  audio_file: string;
  date: string;
  extension: string;
  call_status: string;
  call_record: string | null;
  notes: string | null;
  notification_content: string;
  retry_interval: string;
  max_retries: string;
  created_at: string;
}

function rowToRecord(row: DbRow) {
  return {
    id: row.id,
    audioFile: row.audio_file,
    date: row.date,
    extension: row.extension,
    callStatus: row.call_status,
    callRecord: row.call_record ?? undefined,
    notes: row.notes ?? undefined,
    notificationContent: row.notification_content,
    retryInterval: row.retry_interval,
    maxRetries: row.max_retries,
    createdAt: row.created_at,
  };
}

const SORTABLE_FIELDS: Record<string, string> = {
  date: 'date',
  created_at: 'created_at',
  extension: 'extension',
  call_status: 'call_status',
};

// GET /api/call-schedule
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      startDate, endDate, status, extension,
      page = '1', limit = '10',
      sort = 'created_at', order = 'desc',
    } = req.query;

    const sortField = SORTABLE_FIELDS[sort as string] ?? 'created_at';
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
        whereClause += ` AND call_status IN (${statusList.map(() => '?').join(',')})`;
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

    res.json({ success: true, data: rows.map(rowToRecord), total });
  } catch (error) {
    console.error('[CallSchedule] GET error:', error);
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

    const newId = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO call_schedules
        (id, audio_file, date, extension, call_status, call_record, notes, notification_content, retry_interval, max_retries, created_at)
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

    db.prepare(`
      UPDATE call_schedules SET
        audio_file           = COALESCE(?, audio_file),
        date                 = COALESCE(?, date),
        extension            = COALESCE(?, extension),
        call_status          = COALESCE(?, call_status),
        call_record          = COALESCE(?, call_record),
        notes                = COALESCE(?, notes),
        notification_content = COALESCE(?, notification_content),
        retry_interval       = COALESCE(?, retry_interval),
        max_retries          = COALESCE(?, max_retries)
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
