export type TokenResponseType = {
  errcode: number,
  errmsg: string,
  access_token_expire_time: number,
  access_token: string,
  refresh_token_expire_time: number,
  refresh_token: string,
  ys_id: string
}

export type callDialType = {
  errcode: number,
  errmsg: string,
  call_id: string
}