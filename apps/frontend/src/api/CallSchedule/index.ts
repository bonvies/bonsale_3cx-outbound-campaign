import axios from 'axios'
import type { CallScheduleRecord } from '../../types/callSchedule'
import type { CallScheduleFormData } from '../../components/CallSchedule/CallScheduleDialog'

const { hostname } = window.location
const api_protocol = import.meta.env.VITE_API_PROTOCOL
const port = import.meta.env.VITE_API_PORT
const domain = import.meta.env.VITE_DOMAIN
const HTTP_HOST =
  domain === 'localhost'
    ? `${api_protocol}://${hostname}:${port}`
    : `${api_protocol}://${domain}:${port}`

const BASE_URL = `${HTTP_HOST}/api/call-schedule`

export interface FetchCallSchedulesParams {
  page: number
  limit: number
  sort: string
  order: 'asc' | 'desc'
  extension?: string
  startDate?: string
  endDate?: string
  status?: string // comma-separated, e.g. "排程中,已完成"
}

export interface FetchCallSchedulesResult {
  data: CallScheduleRecord[]
  total: number
}

export async function fetchCallSchedules(opts: FetchCallSchedulesParams): Promise<FetchCallSchedulesResult> {
  const params: Record<string, string> = {
    page: String(opts.page),
    limit: String(opts.limit),
    sort: opts.sort,
    order: opts.order,
  }
  if (opts.extension) params.extension = opts.extension
  if (opts.startDate) params.startDate = opts.startDate
  if (opts.endDate) params.endDate = opts.endDate
  if (opts.status) params.status = opts.status

  const { data: json } = await axios.get<{ success: boolean; data: CallScheduleRecord[]; total: number }>(
    BASE_URL,
    { params }
  )
  return { data: json.data, total: json.total }
}

export async function createCallSchedule(form: CallScheduleFormData): Promise<void> {
  await axios.post(BASE_URL, {
    audioFile: form.audioFile,
    date: form.date,
    extension: form.extension,
    notificationContent: form.notificationContent,
    retryInterval: form.retryInterval,
    maxRetries: form.maxRetries,
    notes: form.notes,
  })
}

export async function updateCallSchedule(id: string, form: CallScheduleFormData): Promise<void> {
  await axios.put(`${BASE_URL}/${id}`, {
    audioFile: form.audioFile,
    date: form.date,
    extension: form.extension,
    notificationContent: form.notificationContent,
    retryInterval: form.retryInterval,
    maxRetries: form.maxRetries,
    notes: form.notes,
  })
}

export async function deleteCallSchedule(id: string): Promise<void> {
  await axios.delete(`${BASE_URL}/${id}`)
}
