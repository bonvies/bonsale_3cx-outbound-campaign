import { createClient, RedisClientType } from 'redis';
import { logWithTimestamp, errorWithTimestamp } from '@shared-local/util/timestamp';

const client: RedisClientType = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
}) as RedisClientType;

client.on('error', (err) => {
  errorWithTimestamp('Redis Client Error:', err);
});

client.on('connect', () => {
  logWithTimestamp({ isForce: true }, '🔗 Redis Client 連接成功');
});

client.on('ready', () => {
  logWithTimestamp({ isForce: true }, '✅ Redis Client 已準備就緒');
});

client.on('end', () => {
  logWithTimestamp({ isForce: true }, '❌ Redis Client 連接已斷開');
});

// 初始化 Redis 連接
export const initRedis = async () => {
  try {
    await client.connect();
    logWithTimestamp('✅ Redis 連接已建立');
  } catch (error) {
    errorWithTimestamp('❌ Redis 連接失敗:', error);
    errorWithTimestamp('💡 請確保 Redis 服務器正在運行：brew services start redis');
    throw error;
  }
};

// 關閉 Redis 連接
export const closeRedis = async () => {
  try {
    await client.quit();
    logWithTimestamp('✅ Redis 連接已關閉');
  } catch (error) {
    errorWithTimestamp('❌ Redis 關閉失敗:', error);
  }
};

export default client;
