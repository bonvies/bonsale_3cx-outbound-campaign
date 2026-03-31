import express, { Router, Request, Response } from 'express';
import {
  listCallSchedules,
  getCallScheduleById,
  createCallSchedule,
  updateCallSchedule,
  deleteCallSchedule,
} from '../services/callScheduleService';
import { notifyFiasWakeupCreate, notifyFiasWakeupClear } from '../components/fiasHandler';

const router: Router = express.Router();

// date 欄位統一使用 UTC ISO 8601 格式（Z 結尾），由前端負責轉換當地時間為 UTC 後傳入。
// 回傳時會依 Bonsale timezoneIANA 轉回當地時間顯示。
const UTC_ISO_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function validateUtcDate(date: string): boolean {
  return UTC_ISO_REGEX.test(date) && !isNaN(new Date(date).getTime());
}

// GET /api/call-schedule
router.get('/', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, status, extension, page, limit, sort, order } = req.query;
    const result = await listCallSchedules({
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      status: status as string | undefined,
      extension: extension as string | undefined,
      page: page as string | undefined,
      limit: limit as string | undefined,
      sort: sort as string | undefined,
      order: order as string | undefined,
    });
    res.json({ success: true, data: result.data, total: result.total });
  } catch (error) {
    console.error('[CallSchedule] GET error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /api/call-schedule/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const record = await getCallScheduleById(req.params.id);
    if (!record) {
      res.status(404).json({ success: false, message: 'Not found' });
      return;
    }
    res.json({ success: true, data: record });
  } catch (error) {
    console.error('[CallSchedule] GET /:id error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// POST /api/call-schedule
router.post('/', (req: Request, res: Response) => {
  try {
    const { audioFile, date, extension, notificationContent, retryInterval, maxRetries = '3', notes = '' } = req.body;

    if (!audioFile || !date || !extension || !notificationContent || !retryInterval) {
      res.status(400).json({ success: false, message: 'Missing required fields' });
      return;
    }

    if (!validateUtcDate(date)) {
      res.status(400).json({ success: false, message: 'date must be a valid UTC ISO 8601 string (e.g. 2026-03-06T06:00:00.000Z)' });
      return;
    }

    const newId = createCallSchedule({ audioFile, date, extension, notificationContent, retryInterval, maxRetries, notes });
    notifyFiasWakeupCreate(extension, date).catch(err => console.error('[CallSchedule] FIAS WR notify error:', err));
    res.json({ success: true, data: { id: newId } });
  } catch (error) {
    if (error instanceof Error && error.message === 'date must be in the future') {
      res.status(400).json({ success: false, message: error.message });
      return;
    }
    console.error('[CallSchedule] POST error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// PUT /api/call-schedule/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { audioFile, date, extension, callRecord, notes, notificationContent, retryInterval, maxRetries } = req.body;

    if (date !== undefined && date !== null && !validateUtcDate(date)) {
      res.status(400).json({ success: false, message: 'date must be a valid UTC ISO 8601 string (e.g. 2026-03-06T06:00:00.000Z)' });
      return;
    }

    // 若 date 或 extension 有異動，先取得舊值以便送 WC 給 PMS
    const oldRecord = (date !== undefined || extension !== undefined)
      ? await getCallScheduleById(id)
      : null;

    const found = updateCallSchedule(id, { audioFile, date, extension, callRecord, notes, notificationContent, retryInterval, maxRetries });
    if (!found) {
      res.status(404).json({ success: false, message: 'Not found' });
      return;
    }

    // 時間或分機有變動：WC（舊）→ WR（新）
    if (oldRecord && (date !== undefined || extension !== undefined)) {
      const newExt  = extension  ?? oldRecord.extension;
      const newDate = date       ?? oldRecord.date;
      notifyFiasWakeupClear(oldRecord.extension, oldRecord.date)
        .then(() => notifyFiasWakeupCreate(newExt, newDate))
        .catch(err => console.error('[CallSchedule] FIAS WC/WR notify error:', err));
    }

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'date must be in the future') {
      res.status(400).json({ success: false, message: error.message });
      return;
    }
    console.error('[CallSchedule] PUT error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// DELETE /api/call-schedule/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // 刪除前取得 extension + date，用來送 WC 給 PMS
    const record = await getCallScheduleById(id);
    deleteCallSchedule(id);

    if (record) {
      notifyFiasWakeupClear(record.extension, record.date)
        .catch(err => console.error('[CallSchedule] FIAS WC notify error:', err));
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[CallSchedule] DELETE error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
