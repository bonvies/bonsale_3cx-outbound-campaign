import { randomUUID } from 'crypto';
import schedule from 'node-schedule';
import { formatInTimeZone } from 'date-fns-tz';
import { getDatabase } from './database';
import { mackeCall } from '@/services/api/newRockApi';
import { registerCall, cancelScheduleJobs } from './callMonitorService';
import { getBonsaleCompanySys } from './api/bonsale';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type DbRow = {
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
};

export type CallScheduleRecord = ReturnType<typeof rowToRecord>;

export type ListCallSchedulesParams = {
  startDate?: string;
  endDate?: string;
  status?: string;
  extension?: string;
  page?: string;
  limit?: string;
  sort?: string;
  order?: string;
};

export type CreateCallScheduleParams = {
  audioFile: string;
  date: string;            // UTC ISO 8601
  extension: string;
  notificationContent: string;
  retryInterval: string;   // 分鐘（字串）
  maxRetries: string;
  notes?: string;
};

export type UpdateCallScheduleParams = {
  audioFile?: string;
  date?: string;
  extension?: string;
  callRecord?: string;
  notes?: string;
  notificationContent?: string;
  retryInterval?: string;
  maxRetries?: string;
};

const SORTABLE_FIELDS: Record<string, string> = {
  date: 'date',
  createdAt: 'createdAt',
  extension: 'extension',
  callStatus: 'callStatus',
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
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

async function getTimezone(): Promise<string> {
  const bonsaleCompanySys = await getBonsaleCompanySys();
  return bonsaleCompanySys?.data?.timezoneIANA ?? 'UTC';
}

/** 建立並登記 node-schedule job（CREATE 和 UPDATE 共用） */
function scheduleCallJob(
  id: string,
  jobDate: Date,
  extension: string,
  maxRetriesNum: number,
  retryIntervalMs: number,
): void {
  const db            = getDatabase();
  const fromExtension = process.env.OM_CALL_FROM_EXTENSION ?? '9038';

  console.log(`[CallScheduleService] Scheduling job ${id} at ${jobDate.toISOString()}`);
  schedule.scheduleJob(id, jobDate, async () => {
    console.log(`[CallScheduleService] Executing job ${id} at ${new Date().toISOString()}`);
    try {
      const result = await mackeCall(fromExtension, extension);
      if (!result.success) {
        console.error(`[CallScheduleService] Call failed for ${id}:`, result.error);
        db.prepare(`UPDATE call_schedules SET callStatus = '錯誤' WHERE id = ?`).run(id);
        return;
      }
      db.prepare(`UPDATE call_schedules SET callStatus = '撥打中' WHERE id = ?`).run(id);
      registerCall({ scheduleId: id, extension, from: fromExtension, maxRetries: maxRetriesNum, retryIntervalMs });
    } catch (err) {
      console.error(`[CallScheduleService] Job execution failed for ${id}:`, err);
      db.prepare(`UPDATE call_schedules SET callStatus = '錯誤' WHERE id = ?`).run(id);
    }
  });
}

// ─────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────

/** GET list - 支援過濾、分頁、排序 */
export async function listCallSchedules(params: ListCallSchedulesParams): Promise<{ data: CallScheduleRecord[]; total: number }> {
  const db = getDatabase();
  const {
    startDate, endDate, status, extension,
    page = '1', limit = '10',
    sort = 'createdAt', order = 'desc',
  } = params;

  const sortField = SORTABLE_FIELDS[sort] ?? 'createdAt';
  const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  let whereClause = 'WHERE 1=1';
  const queryParams: (string | number)[] = [];

  if (startDate) {
    whereClause += ' AND date >= ?';
    queryParams.push(startDate);
  }
  if (endDate) {
    whereClause += ' AND date <= ?';
    queryParams.push(endDate);
  }
  if (status) {
    const statusList = status.split(',').map(s => s.trim()).filter(Boolean);
    if (statusList.length > 0) {
      whereClause += ` AND callStatus IN (${statusList.map(() => '?').join(',')})`;
      queryParams.push(...statusList);
    }
  }
  if (extension) {
    whereClause += ' AND extension LIKE ?';
    queryParams.push(`%${extension}%`);
  }

  const countResult = db.prepare(
    `SELECT COUNT(*) as count FROM call_schedules ${whereClause}`
  ).get(...queryParams) as { count: number };

  const pageNum  = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, parseInt(limit, 10) || 10);
  const paginatedParams = [...queryParams, limitNum, (pageNum - 1) * limitNum];

  const rows = db.prepare(
    `SELECT * FROM call_schedules ${whereClause} ORDER BY ${sortField} ${sortOrder} LIMIT ? OFFSET ?`
  ).all(...paginatedParams) as DbRow[];

  const timezone = await getTimezone();
  return { data: rows.map(row => rowToRecord(row, timezone)), total: countResult.count };
}

/** GET by id */
export async function getCallScheduleById(id: string): Promise<CallScheduleRecord | null> {
  const db  = getDatabase();
  const row = db.prepare('SELECT * FROM call_schedules WHERE id = ?').get(id) as DbRow | undefined;
  if (!row) return null;
  const timezone = await getTimezone();
  return rowToRecord(row, timezone);
}

/** POST - 建立排程並登記 job */
export function createCallSchedule(params: CreateCallScheduleParams): string {
  const { audioFile, date, extension, notificationContent, retryInterval, maxRetries, notes = '' } = params;

  if (new Date(date) <= new Date()) {
    throw new Error('date must be in the future');
  }

  const db            = getDatabase();
  const newId         = randomUUID();
  const createdAt     = new Date().toISOString();
  const maxRetriesNum = Math.max(0, parseInt(maxRetries, 10) || 0);
  const retryIntervalMs = Math.max(0, parseFloat(retryInterval) || 0) * 60 * 1000;

  db.prepare(`
    INSERT INTO call_schedules
      (id, audioFile, date, extension, callStatus, callRecord, notes, notificationContent, retryInterval, maxRetries, createdAt)
    VALUES (?, ?, ?, ?, '排程中', NULL, ?, ?, ?, ?, ?)
  `).run(newId, audioFile, date, extension, notes, notificationContent, retryInterval, maxRetries, createdAt);

  scheduleCallJob(newId, new Date(date), extension, maxRetriesNum, retryIntervalMs);
  return newId;
}

/** PUT - 更新欄位，取消舊 job，以新參數重新排程；回傳 false 表示 id 不存在 */
export function updateCallSchedule(id: string, params: UpdateCallScheduleParams): boolean {
  const db = getDatabase();
  const { audioFile, date, extension, callRecord, notes, notificationContent, retryInterval, maxRetries } = params;

  if (date !== undefined && date !== null && new Date(date) <= new Date()) {
    throw new Error('date must be in the future');
  }

  db.prepare(`
    UPDATE call_schedules SET
      audioFile           = COALESCE(?, audioFile),
      date                = COALESCE(?, date),
      extension           = COALESCE(?, extension),
      callStatus          = '排程中',
      callRecord          = COALESCE(?, callRecord),
      notes               = COALESCE(?, notes),
      notificationContent = COALESCE(?, notificationContent),
      retryInterval       = COALESCE(?, retryInterval),
      maxRetries          = COALESCE(?, maxRetries)
    WHERE id = ?
  `).run(
    audioFile ?? null, date ?? null, extension ?? null,
    callRecord ?? null, notes ?? null, notificationContent ?? null,
    retryInterval ?? null, maxRetries ?? null,
    id
  );

  const updatedRow = db.prepare(
    'SELECT date, extension, retryInterval, maxRetries FROM call_schedules WHERE id = ?'
  ).get(id) as { date: string; extension: string; retryInterval: string; maxRetries: string } | undefined;

  if (!updatedRow) return false;

  cancelScheduleJobs(id, schedule.scheduledJobs);
  scheduleCallJob(
    id,
    new Date(updatedRow.date),
    updatedRow.extension,
    Math.max(0, parseInt(updatedRow.maxRetries, 10) || 0),
    Math.max(0, parseFloat(updatedRow.retryInterval) || 0) * 60 * 1000,
  );
  return true;
}

/** DELETE - 刪除記錄並取消所有相關 job */
export function deleteCallSchedule(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM call_schedules WHERE id = ?').run(id);
  cancelScheduleJobs(id, schedule.scheduledJobs);
}

/** 重啟恢復 - 將 DB 中未完成的排程重新登記 job */
export function recoverPendingSchedules(): void {
  const db  = getDatabase();
  const now = new Date().toISOString();

  // 已過期但仍是「排程中」→ 標記為錯誤，寫入原因
  db.prepare(`
    UPDATE call_schedules
    SET callStatus = '錯誤',
        notes = CASE WHEN notes IS NULL OR notes = '' THEN '伺服器重啟時排程已過期' ELSE notes || ' | 伺服器重啟時排程已過期' END
    WHERE callStatus = '排程中' AND date < ?
  `).run(now);

  // 「等待重試」→ 標記為錯誤（retry job 在重啟後已消失，不會再執行），寫入原因
  db.prepare(`
    UPDATE call_schedules
    SET callStatus = '錯誤',
        notes = CASE WHEN notes IS NULL OR notes = '' THEN '伺服器重啟，重試排程已中斷' ELSE notes || ' | 伺服器重啟，重試排程已中斷' END
    WHERE callStatus LIKE '等待重試%'
  `).run();

  // 未來的「排程中」→ 重新登記 job
  const rows = db.prepare(`
    SELECT id, date, extension, retryInterval, maxRetries
    FROM call_schedules
    WHERE callStatus = '排程中' AND date >= ?
  `).all(now) as Pick<DbRow, 'id' | 'date' | 'extension' | 'retryInterval' | 'maxRetries'>[];

  for (const row of rows) {
    scheduleCallJob(
      row.id,
      new Date(row.date),
      row.extension,
      Math.max(0, parseInt(row.maxRetries, 10) || 0),
      Math.max(0, parseFloat(row.retryInterval) || 0) * 60 * 1000,
    );
  }

  console.log(`[CallScheduleService] 恢復排程：${rows.length} 筆重新登記，過期排程已標記為錯誤`);
}
