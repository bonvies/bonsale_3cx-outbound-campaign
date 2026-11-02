import axios from 'axios'

const { hostname } = window.location
const api_protocol = import.meta.env.VITE_API_PROTOCOL
const port = import.meta.env.VITE_API_PORT
const domain = import.meta.env.VITE_DOMAIN
const HTTP_HOST =
  domain === 'localhost'
    ? `${api_protocol}://${hostname}:${port}`
    : `${api_protocol}://${domain}:${port}`

/** 取得站點時區（後端 SITE_TIMEZONE，IANA 格式） */
export async function fetchSiteTimezone(): Promise<string> {
  const { data } = await axios.get<{ success: boolean; data: { timezoneIANA: string } }>(
    `${HTTP_HOST}/api/config/timezone`
  )
  return data.data.timezoneIANA
}
