export interface CallScheduleRecord {
  id: string
  audioFile: string // 鈴聲名稱，例如: "預設鈴聲"
  date: string // 日期，例如: "2025/12/05 07:30"
  extension: string // 分機號，例如: "A館 10F - 1002"
  callStatus: '排程中' | '已完成' | '失敗' // 撥號狀態
  callRecord?: string // 撥號紀錄
  notes?: string // 備註
  notificationContent: string // 通知內容
  retryInterval: string // 重試間隔，單位分鐘
}

export interface CallScheduleFilters {
  startDate: Date | null
  endDate: Date | null
  status: string[] // 可多選: ['全部'] | ['排程中', '已完成', '失敗']
  search: string
}

export type CallStatus = '排程中' | '已完成' | '失敗'
