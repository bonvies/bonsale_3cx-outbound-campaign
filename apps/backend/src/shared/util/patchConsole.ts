import dotenv from 'dotenv';
dotenv.config();

const LOG_TIMEZONE = process.env.LOG_TIMEZONE ?? 'Asia/Taipei';

const getTaiwanTimestamp = () => {
  const now = new Date();

  // 使用 Intl.DateTimeFormat 直接格式化
  const formatter = new Intl.DateTimeFormat('en-ZA', { // en-ZA 預設輸出就是 YYYY/MM/DD
    timeZone: LOG_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false // 使用 24 小時制
  });

  // 格式化出來會是 "2026/06/12, 16:12:23"，把斜線換成橫線，逗號拿掉即可
  return formatter.format(now).replace(/\//g, '-').replace(',', '');
};

const _log = console.log.bind(console);
const _warn = console.warn.bind(console);
const _error = console.error.bind(console);

console.log = (...args: unknown[]) => _log(`[${getTaiwanTimestamp()}]`, ...args);
console.warn = (...args: unknown[]) => _warn(`[${getTaiwanTimestamp()}]`, ...args);
console.error = (...args: unknown[]) => _error(`[${getTaiwanTimestamp()}]`, ...args);

console.log(`🕐 專案日誌時間時區設定為 ${LOG_TIMEZONE}`);