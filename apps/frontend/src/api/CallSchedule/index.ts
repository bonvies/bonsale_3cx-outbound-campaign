import axios from 'axios'
import dayjs from 'dayjs'
import type { CallScheduleRecord, CallScheduleFilters } from '../../types/callSchedule'
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
  pageSize: number
  isSearchActive: boolean
  filters: CallScheduleFilters
}

export interface FetchCallSchedulesResult {
  data: CallScheduleRecord[]
  total: number
}

export async function fetchCallSchedules(opts: FetchCallSchedulesParams): Promise<FetchCallSchedulesResult> {
  const params: Record<string, string> = {
    page: String(opts.page),
    pageSize: String(opts.pageSize),
  }

  if (opts.isSearchActive) {
    if (opts.filters.startDate) {
      params.startDate = dayjs(opts.filters.startDate).format('YYYY/MM/DD HH:mm')
    }
    if (opts.filters.endDate) {
      params.endDate = dayjs(opts.filters.endDate).format('YYYY/MM/DD HH:mm')
    }
    if (!opts.filters.status.includes('全部')) {
      params.status = opts.filters.status.join(',')
    }
    if (opts.filters.search.trim()) {
      params.search = opts.filters.search.trim()
    }
  }

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
