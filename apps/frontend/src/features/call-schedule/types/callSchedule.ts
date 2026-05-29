export type CallStatus =
  | 'SCHEDULED'
  | 'CALLING'
  | 'RINGING'
  | 'ANSWERED'
  | 'WAITING_RETRY'
  | 'NO_ANSWER'
  | 'ERROR'

export const STATUS_LABEL: Record<CallStatus, string> = {
  SCHEDULED:     '排程中',
  CALLING:       '撥打中',
  RINGING:       '響鈴中',
  ANSWERED:      '已接聽',
  WAITING_RETRY: '等待重試',
  NO_ANSWER:     '未接聽',
  ERROR:         '錯誤',
}

export interface CallScheduleRecord {
  id: string
  audioFile: string // 鈴聲名稱，例如: "預設鈴聲"
  date: string // 日期，例如: "2025/12/05 07:30"
  extension: string // 分機號，例如: "A館 10F - 1002"
  callStatus: CallStatus // 撥號狀態
  retryCount?: string // 重試進度，例如: "1/3"（僅 WAITING_RETRY 時有值）
  callRecord?: string // 撥號紀錄
  notes?: string // 備註
  notificationContent: string // 通知內容
  retryInterval: string // 重試間隔，單位分鐘
  maxRetries?: string // 最多重試次數
  createdAt?: string // 建立時間 (ISO string)
  roomNum?: string // 房間號碼
}

export interface CallScheduleFilters {
  startDate: Date | null
  endDate: Date | null
  status: string[] // 可多選: ['全部'] | ['SCHEDULED', 'ERROR', ...]
  extension: string
}
