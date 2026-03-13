import axios from 'axios'

const { hostname } = window.location
const api_protocol = import.meta.env.VITE_API_PROTOCOL
const port = import.meta.env.VITE_API_PORT
const domain = import.meta.env.VITE_DOMAIN
const HTTP_HOST =
  domain === 'localhost'
    ? `${api_protocol}://${hostname}:${port}`
    : `${api_protocol}://${domain}:${port}`

export type AuthConfig = {
  OutboundCampaign: boolean
  CallSchedule: boolean
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  const { data } = await axios.get<{ success: boolean; data: AuthConfig }>(`${HTTP_HOST}/api/config/auth`)
  return data.data
}
