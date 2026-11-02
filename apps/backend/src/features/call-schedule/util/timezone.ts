/**
 * 站點時區（IANA 格式，例如 Asia/Taipei）。
 * SITE_TIMEZONE 為必填，啟動時已由 validateEnv() 驗證格式，這裡可直接讀取。
 */
export function getSiteTimezone(): string {
  return process.env.SITE_TIMEZONE!;
}
