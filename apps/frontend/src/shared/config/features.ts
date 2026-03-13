import { Dashboard, Schedule } from '@mui/icons-material';
import type { SvgIconComponent } from '@mui/icons-material';
import type { AuthConfig } from '../api/config';

export type FeatureConfig = {
  key: keyof AuthConfig
  path: string
  label: string
  icon: SvgIconComponent
}

/**
 * 所有功能的統一定義。
 * 新增功能時只需在此加一筆，Navbar 與 Layout 路由 guard 會自動生效。
 */
export const FEATURES: FeatureConfig[] = [
  { key: 'OutboundCampaign', path: '/outbound-campaign', label: '專案自動外撥', icon: Dashboard },
  { key: 'CallSchedule',     path: '/call-schedule',     label: '自動語音通知', icon: Schedule  },
];
