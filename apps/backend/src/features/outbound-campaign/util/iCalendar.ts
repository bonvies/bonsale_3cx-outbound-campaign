import { rrulestr } from 'rrule';
import { logWithTimestamp } from '@shared-local/util/timestamp';

// 檢查兩個日期是否為同一天 (UTC)
function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getUTCFullYear() === date2.getUTCFullYear() &&
    date1.getUTCMonth() === date2.getUTCMonth() &&
    date1.getUTCDate() === date2.getUTCDate()
  );
}

// 檢查現在是否符合檔期
export function isTodayInSchedule(rruleString: string): boolean {
  const rule = rrulestr(rruleString);

  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrowUTC = new Date(todayUTC.getTime() + 24 * 60 * 60 * 1000);

  // 1. 先檢查今天是否有符合 RRULE 的 occurrence
  const occurrences = rule.between(todayUTC, tomorrowUTC, true);

  if (occurrences.length === 0) {
    logWithTimestamp('今天沒有符合的事件');
    return false;
  }

  logWithTimestamp('今天有符合的事件:', occurrences);

  // 2. 取得 DTSTART 和 UNTIL
  const dtstart = rule.options.dtstart;
  const until = rule.options.until;

  // 3. 如果今天是 DTSTART 當天，檢查是否已過開始時間
  if (dtstart && isSameDay(now, dtstart)) {
    if (now < dtstart) {
      logWithTimestamp(`尚未到達開始時間: ${dtstart.toISOString()}，現在: ${now.toISOString()}`);
      return false;
    }
  }

  // 4. 如果今天是 UNTIL 當天，檢查是否已超過結束時間
  if (until && isSameDay(now, until)) {
    if (now > until) {
      logWithTimestamp(`已超過結束時間: ${until.toISOString()}，現在: ${now.toISOString()}`);
      return false;
    }
  }

  logWithTimestamp('時間檢查通過');
  return true;
}

