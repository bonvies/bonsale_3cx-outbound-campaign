import { createClient, RedisClientType } from 'redis';

const MAX_RECONNECT_RETRIES = 10;

const client: RedisClientType = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    reconnectStrategy: (retries) => {
      if (retries >= MAX_RECONNECT_RETRIES) {
        console.error(`Redis 重連次數已達上限（${MAX_RECONNECT_RETRIES} 次），停止重試`);
        return new Error('Redis 重連失敗：超過最大重試次數');
      }
      const delay = Math.min(retries * 500, 5000); // 每次增加 500ms，最多等 5 秒
      return delay;
    },
  },
}) as RedisClientType;

client.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

client.on('connect', () => {
  console.log('🔗 Redis Client 連接成功');
});

client.on('ready', () => {
  console.log('✅ Redis Client 已準備就緒');
});

client.on('reconnecting', () => {
  console.log('🔄 Redis Client 重連中...');
});

client.on('end', () => {
  console.log('❌ Redis Client 連接已斷開');
});

// 初始化 Redis 連接
export const initRedis = async () => {
  try {
    await client.connect();
    console.log('✅ Redis 連接已建立');
  } catch (error) {
    console.error('❌ Redis 連接失敗:', error);
    console.error('💡 請確保 Redis 服務器正在運行：brew services start redis');
    throw error;
  }
};

// 關閉 Redis 連接
export const closeRedis = async () => {
  try {
    await client.quit();
    console.log('✅ Redis 連接已關閉');
  } catch (error) {
    console.error('❌ Redis 關閉失敗:', error);
  }
};

export default client;
