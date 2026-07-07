import { getBonsaleCompanySys } from '@shared-local/services/api/bonsale';

export async function getSiteTimezone(): Promise<string> {
  if (process.env.SITE_TIMEZONE) return process.env.SITE_TIMEZONE;
  const bonsaleCompanySys = await getBonsaleCompanySys();
  return bonsaleCompanySys?.data?.timezoneIANA ?? 'UTC';
}
