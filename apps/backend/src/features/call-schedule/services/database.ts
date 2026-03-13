import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

export async function initDatabase(): Promise<void> {
  const dbPath = process.env.SQLITE_DB_PATH || path.resolve('./data/call_schedules.db');
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS call_schedules (
      id                   TEXT PRIMARY KEY,
      audioFile           TEXT NOT NULL,
      date                 TEXT NOT NULL,
      extension            TEXT NOT NULL,
      callStatus          TEXT NOT NULL DEFAULT '排程中',
      callRecord          TEXT,
      notes                TEXT,
      notificationContent TEXT NOT NULL,
      retryInterval       TEXT NOT NULL,
      maxRetries          TEXT NOT NULL DEFAULT '3',
      createdAt           TEXT NOT NULL
    )
  `);

  console.log(`[Database] Initialized at: ${dbPath}`);
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}
