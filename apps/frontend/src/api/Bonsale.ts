import axios from 'axios'

const { hostname } = window.location
const api_protocol = import.meta.env.VITE_API_PROTOCOL
const port = import.meta.env.VITE_API_PORT
const domain = import.meta.env.VITE_DOMAIN
const HTTP_HOST =
  domain === 'localhost'
    ? `${api_protocol}://${hostname}:${port}`
    : `${api_protocol}://${domain}:${port}`

export const BASE_URL = `${HTTP_HOST}/api/bonsale`

export type BonsaleCompanySys = {
  coyCode: number
  coyName: string
  companyNumber: string
  email: string
  currencyDefault: string
  companyType: number
  gstNo: string
  regOffice1: string
  regOffice2: string
  regOffice3: string
  regOffice4: string
  regOffice5: string
  telephone: string
  fax: string
  openingTime: string
  closingTime: string
  is24h: number
  timezoneIANA: string
}

export async function fetchBonsaleCompany(): Promise<BonsaleCompanySys> {
  const { data } = await axios.get<BonsaleCompanySys>(`${BASE_URL}/company`)
  return data
}
