import dotenv from 'dotenv';
dotenv.config();

const LOG_TIMEZONE = process.env.LOG_TIMEZONE ?? 'Asia/Taipei';

const getTaiwanTimestamp = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: LOG_TIMEZONE }));
  return d.toISOString().replace('T', ' ').substring(0, 19);
};

const _log = console.log.bind(console);
const _warn = console.warn.bind(console);
const _error = console.error.bind(console);

console.log = (...args: unknown[]) => _log(`[${getTaiwanTimestamp()}]`, ...args);
console.warn = (...args: unknown[]) => _warn(`[${getTaiwanTimestamp()}]`, ...args);
console.error = (...args: unknown[]) => _error(`[${getTaiwanTimestamp()}]`, ...args);
