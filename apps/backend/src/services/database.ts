import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { logWithTimestamp, errorWithTimestamp } from '../util/timestamp';

dotenv.config();

// MySQL 連線池實例
let pool: mysql.Pool | null = null;

/**
 * 初始化 MySQL 連線池
 */
export async function initDatabase(): Promise<void> {
  try {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'bonsale_3cx',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });

    // 測試連線
    const connection = await pool.getConnection();
    logWithTimestamp({ isForce: true }, '✅ MySQL 資料庫連線成功');
    connection.release();
  } catch (error) {
    errorWithTimestamp('❌ MySQL 資料庫連線失敗:', error);
    throw error;
  }
}

/**
 * 關閉 MySQL 連線池
 */
export async function closeDatabase(): Promise<void> {
  try {
    if (pool) {
      await pool.end();
      pool = null;
      logWithTimestamp({ isForce: true }, '✅ MySQL 資料庫連線已關閉');
    }
  } catch (error) {
    errorWithTimestamp('❌ 關閉 MySQL 資料庫連線失敗:', error);
    throw error;
  }
}

/**
 * 取得資料庫連線池實例
 */
export function getDatabase(): mysql.Pool {
  if (!pool) {
    throw new Error('❌ 資料庫連線池尚未初始化，請先呼叫 initDatabase()');
  }
  return pool;
}

/**
 * 執行 SQL 查詢的輔助函式
 * @param sql SQL 語句
 * @param params 參數
 * @returns 查詢結果
 */
export async function query<T = any>(
  sql: string,
  params?: any[]
): Promise<T> {
  const db = getDatabase();
  const [rows] = await db.execute(sql, params);
  return rows as T;
}

/**
 * 執行事務的輔助函式
 * @param callback 事務回調函式
 * @returns 事務執行結果
 */
export async function transaction<T>(
  callback: (connection: mysql.PoolConnection) => Promise<T>
): Promise<T> {
  const db = getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export default {
  initDatabase,
  closeDatabase,
  getDatabase,
  query,
  transaction,
};
