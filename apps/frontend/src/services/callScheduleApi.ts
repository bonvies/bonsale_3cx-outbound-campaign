import axios from 'axios'
import type { CallScheduleRecord } from '../types/callSchedule'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4020'

// 建立 axios 實例
const apiClient = axios.create({
  baseURL: `${API_BASE_URL}/api/call-schedule`,
  headers: {
    'Content-Type': 'application/json',
  },
})

// API 回應格式
interface ApiResponse<T> {
  success: boolean
  data: T
  message?: string
  timestamp: string
}

interface PaginatedApiResponse<T> extends ApiResponse<T> {
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

// API 請求的資料格式
export interface CreateCallScheduleDto {
  audioFile: string
  date: string // ISO 8601 格式
  extension: string
  callStatus?: 'scheduling' | 'completed' | 'failed'
  callRecord?: string
  notes?: string
  notificationContent: string
  retryInterval: number
}

export interface UpdateCallScheduleDto {
  audioFile: string
  date: string
  extension: string
  callStatus: 'scheduling' | 'completed' | 'failed'
  callRecord?: string
  notes?: string
  notificationContent: string
  retryInterval: number
}

export interface CallScheduleQueryParams {
  page?: number
  limit?: number
  callStatus?: 'scheduling' | 'completed' | 'failed'
  extension?: string
  dateFrom?: string
  dateTo?: string
  audioFile?: string
  notificationContent?: string
  sortBy?: 'date' | 'created_at' | 'updated_at' | 'call_status'
  sortOrder?: 'ASC' | 'DESC'
  search?: string
}

// API 回傳的資料格式
interface ApiCallScheduleRecord {
  id: string
  audioFile: string
  date: string
  extension: string
  callStatus: 'scheduling' | 'completed' | 'failed'
  callRecord: string | null
  notes: string | null
  notificationContent: string
  retryInterval: number
  createdAt: string
  updatedAt: string
}

// 狀態映射：後端 -> 前端
const statusMap: Record<string, '排程中' | '已完成' | '失敗'> = {
  'scheduling': '排程中',
  'completed': '已完成',
  'failed': '失敗'
}

// 狀態映射：前端 -> 後端
const reverseStatusMap: Record<string, 'scheduling' | 'completed' | 'failed'> = {
  '排程中': 'scheduling',
  '已完成': 'completed',
  '失敗': 'failed'
}

// 轉換 API 資料為前端格式
const transformApiRecord = (apiRecord: ApiCallScheduleRecord): CallScheduleRecord => ({
  id: apiRecord.id,
  audioFile: apiRecord.audioFile,
  date: apiRecord.date,
  extension: apiRecord.extension,
  callStatus: statusMap[apiRecord.callStatus] || '排程中',
  callRecord: apiRecord.callRecord || undefined,
  notes: apiRecord.notes || undefined,
  notificationContent: apiRecord.notificationContent,
  retryInterval: apiRecord.retryInterval.toString()
})

/**
 * 取得通話排程列表
 */
export async function getCallSchedules(
  params?: CallScheduleQueryParams
): Promise<{ data: CallScheduleRecord[]; pagination: any }> {
  const response = await apiClient.get<PaginatedApiResponse<ApiCallScheduleRecord[]>>('/', {
    params
  })

  return {
    data: response.data.data.map(transformApiRecord),
    pagination: response.data.pagination
  }
}

/**
 * 取得單一通話排程
 */
export async function getCallSchedule(id: string): Promise<CallScheduleRecord> {
  const response = await apiClient.get<ApiResponse<ApiCallScheduleRecord>>(`/${id}`)
  return transformApiRecord(response.data.data)
}

/**
 * 新增通話排程
 */
export async function createCallSchedule(data: CreateCallScheduleDto): Promise<CallScheduleRecord> {
  const response = await apiClient.post<ApiResponse<ApiCallScheduleRecord>>('/', data)
  return transformApiRecord(response.data.data)
}

/**
 * 更新通話排程（完整更新）
 */
export async function updateCallSchedule(
  id: string,
  data: UpdateCallScheduleDto
): Promise<CallScheduleRecord> {
  const response = await apiClient.put<ApiResponse<ApiCallScheduleRecord>>(`/${id}`, data)
  return transformApiRecord(response.data.data)
}

/**
 * 部分更新通話排程
 */
export async function patchCallSchedule(
  id: string,
  data: Partial<UpdateCallScheduleDto>
): Promise<CallScheduleRecord> {
  const response = await apiClient.patch<ApiResponse<ApiCallScheduleRecord>>(`/${id}`, data)
  return transformApiRecord(response.data.data)
}

/**
 * 刪除通話排程
 */
export async function deleteCallSchedule(id: string): Promise<void> {
  await apiClient.delete(`/${id}`)
}

// 匯出狀態映射
export { statusMap, reverseStatusMap }
