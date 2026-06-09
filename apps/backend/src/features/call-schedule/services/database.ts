import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

// ─────────────────────────────────────────────
// Migrations
// ─────────────────────────────────────────────

/**
 * 資料庫 migration 清單。
 * 每個項目包含版本號與對應的升級函式，依序執行，不可更動已發布的版本。
 * 新增欄位或索引時，在陣列尾端新增一個新項目即可。
 *
 * @example 新增欄位範例
 * {
 *   version: 2,
 *   up: (db) => {
 *     db.exec(`ALTER TABLE call_schedules ADD COLUMN foo TEXT`);
 *   },
 * }
 */
const MIGRATIONS: { version: number; up: (db: Database.Database) => void }[] = [
  {
    // v1：將 retryInterval、maxRetries、retryCount 從 TEXT 改為 INTEGER，並建立常用欄位的索引
    version: 1,
    up: (database) => {
      const oldExists = !!database.prepare(
        `SELECT 1 FROM sqlite_master WHERE type='table' AND name='call_schedules'`
      ).get();

      if (oldExists) {
        // 舊表已存在（TEXT schema）：建新表 → 搬資料 → 刪舊表 → 改名
        // retryCount 舊格式為 "n/m"，CAST 時只取 "/" 前的數字
        database.exec(`
          CREATE TABLE call_schedules_new (
            id                   TEXT    PRIMARY KEY,
            audioFile            TEXT    NOT NULL DEFAULT '',
            date                 TEXT    NOT NULL,
            extension            TEXT    NOT NULL,
            callStatus           TEXT    NOT NULL DEFAULT 'SCHEDULED',
            callRecord           TEXT,
            notes                TEXT,
            notificationContent  TEXT    NOT NULL DEFAULT '',
            retryInterval        INTEGER NOT NULL DEFAULT 0,
            maxRetries           INTEGER NOT NULL DEFAULT 3,
            createdAt            TEXT    NOT NULL,
            roomNum              TEXT,
            retryCount           INTEGER
          );
          INSERT INTO call_schedules_new
            SELECT
              id, audioFile, date, extension, callStatus, callRecord, notes, notificationContent,
              CAST(retryInterval AS INTEGER),
              CAST(maxRetries AS INTEGER),
              createdAt, roomNum,
              CASE
                WHEN retryCount IS NULL THEN NULL
                WHEN retryCount LIKE '%/%' THEN CAST(substr(retryCount, 1, instr(retryCount, '/') - 1) AS INTEGER)
                ELSE CAST(retryCount AS INTEGER)
              END
            FROM call_schedules;
          DROP TABLE call_schedules;
          ALTER TABLE call_schedules_new RENAME TO call_schedules;
        `);
      } else {
        // 全新安裝：直接建正確的表
        database.exec(`
          CREATE TABLE call_schedules (
            id                   TEXT    PRIMARY KEY,
            audioFile            TEXT    NOT NULL DEFAULT '',
            date                 TEXT    NOT NULL,
            extension            TEXT    NOT NULL,
            callStatus           TEXT    NOT NULL DEFAULT 'SCHEDULED',
            callRecord           TEXT,
            notes                TEXT,
            notificationContent  TEXT    NOT NULL DEFAULT '',
            retryInterval        INTEGER NOT NULL DEFAULT 0,
            maxRetries           INTEGER NOT NULL DEFAULT 3,
            createdAt            TEXT    NOT NULL,
            roomNum              TEXT,
            retryCount           INTEGER
          );
        `);
      }

      // 加入常用查詢欄位的索引，加速 callStatus / date / extension 的篩選
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_call_schedules_status    ON call_schedules(callStatus);
        CREATE INDEX IF NOT EXISTS idx_call_schedules_date      ON call_schedules(date);
        CREATE INDEX IF NOT EXISTS idx_call_schedules_extension ON call_schedules(extension);
      `);
    },
  },
];

/**
 * 讀取 DB 的 user_version（SQLite header 內建整數，預設 0），
 * 依序執行版本號大於 current 的 migration，每步完成後更新 user_version。
 */
function migrate(database: Database.Database): void {
  const current = database.pragma('user_version', { simple: true }) as number;
  console.log(`[Database] Current version: ${current}`);

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    migration.up(database);
    database.pragma(`user_version = ${migration.version}`);
    console.log(`[Database] Migration v${migration.version} applied`);
  }
}

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────

export async function initDatabase(): Promise<void> {
  // 路徑相對於 Node.js process cwd（Docker 中為 /app/apps/backend）
  // 實際路徑：/app/apps/backend/data/call_schedules.db
  // Docker volume 需掛載至 /app/apps/backend/data 以持久化資料
  const dbPath = path.resolve('./data/call_schedules.db');
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);
  migrate(db);

  console.log(`[Database] Initialized at: ${dbPath}`);
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}
