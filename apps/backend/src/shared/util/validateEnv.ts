import Joi from 'joi';

// 依 ENABLE_OUTBOUND_CAMPAIGN / ENABLE_CALL_SCHEDULE / TELEPHONE_EQUIPMENT / FIAS_MODE
// 的目前組合，驗證對應必填的環境變數是否存在。詳細分類請見 apps/backend/.env.example。
const schema = Joi.object({
  CLIENT_ID: Joi.string().required(),

  ENABLE_OUTBOUND_CAMPAIGN: Joi.string().valid('true', 'false').required(),
  ENABLE_CALL_SCHEDULE: Joi.string().valid('true', 'false').required(),
  ENABLE_FIAS: Joi.string().valid('true', 'false').optional(),

  TELEPHONE_EQUIPMENT: Joi.string()
    .valid('NewRock', 'Yeastar', 'FreeSwitch')
    .when('ENABLE_CALL_SCHEDULE', { is: 'true', then: Joi.required(), otherwise: Joi.allow('') }),

  BONSALE_HOST: Joi.string().when('ENABLE_OUTBOUND_CAMPAIGN', { is: 'true', then: Joi.required(), otherwise: Joi.allow('') }),
  BONSALE_X_API_KEY: Joi.string().when('ENABLE_OUTBOUND_CAMPAIGN', { is: 'true', then: Joi.required(), otherwise: Joi.allow('') }),
  BONSALE_X_API_SECRET: Joi.string().when('ENABLE_OUTBOUND_CAMPAIGN', { is: 'true', then: Joi.required(), otherwise: Joi.allow('') }),
  HTTP_HOST_3CX: Joi.string().when('ENABLE_OUTBOUND_CAMPAIGN', { is: 'true', then: Joi.required(), otherwise: Joi.allow('') }),
  WS_HOST_3CX: Joi.string().when('ENABLE_OUTBOUND_CAMPAIGN', { is: 'true', then: Joi.required(), otherwise: Joi.allow('') }),
  HTTP_HOST_MESSAGE_FOR_AI: Joi.string().when('ENABLE_OUTBOUND_CAMPAIGN', { is: 'true', then: Joi.required(), otherwise: Joi.allow('') }),
  POST_9000_BASIC_AUTH: Joi.string().when('ENABLE_OUTBOUND_CAMPAIGN', { is: 'true', then: Joi.required(), otherwise: Joi.allow('') }),

  NEW_ROCK_API_HOST: Joi.string().when('ENABLE_CALL_SCHEDULE', {
    is: 'true',
    then: Joi.when('TELEPHONE_EQUIPMENT', { is: 'NewRock', then: Joi.required(), otherwise: Joi.allow('') }),
    otherwise: Joi.allow(''),
  }),
  NEW_ROCK_API_PATH: Joi.string().when('ENABLE_CALL_SCHEDULE', {
    is: 'true',
    then: Joi.when('TELEPHONE_EQUIPMENT', { is: 'NewRock', then: Joi.required(), otherwise: Joi.allow('') }),
    otherwise: Joi.allow(''),
  }),
  NEW_ROCK_API_MONITOR_PORT: Joi.string().when('ENABLE_CALL_SCHEDULE', {
    is: 'true',
    then: Joi.when('TELEPHONE_EQUIPMENT', { is: 'NewRock', then: Joi.required(), otherwise: Joi.allow('') }),
    otherwise: Joi.allow(''),
  }),

  YEASTAR_API_HOST: Joi.string().when('ENABLE_CALL_SCHEDULE', {
    is: 'true',
    then: Joi.when('TELEPHONE_EQUIPMENT', { is: 'Yeastar', then: Joi.required(), otherwise: Joi.allow('') }),
    otherwise: Joi.allow(''),
  }),
  YEASTAR_API_PATH: Joi.string().when('ENABLE_CALL_SCHEDULE', {
    is: 'true',
    then: Joi.when('TELEPHONE_EQUIPMENT', { is: 'Yeastar', then: Joi.required(), otherwise: Joi.allow('') }),
    otherwise: Joi.allow(''),
  }),
  YEASTAR_USERNAME: Joi.string().when('ENABLE_CALL_SCHEDULE', {
    is: 'true',
    then: Joi.when('TELEPHONE_EQUIPMENT', { is: 'Yeastar', then: Joi.required(), otherwise: Joi.allow('') }),
    otherwise: Joi.allow(''),
  }),
  YEASTAR_PASSWORD: Joi.string().when('ENABLE_CALL_SCHEDULE', {
    is: 'true',
    then: Joi.when('TELEPHONE_EQUIPMENT', { is: 'Yeastar', then: Joi.required(), otherwise: Joi.allow('') }),
    otherwise: Joi.allow(''),
  }),

  FREESWITCH_API_URL: Joi.string().when('ENABLE_CALL_SCHEDULE', {
    is: 'true',
    then: Joi.when('TELEPHONE_EQUIPMENT', { is: 'FreeSwitch', then: Joi.required(), otherwise: Joi.allow('') }),
    otherwise: Joi.allow(''),
  }),
  FREESWITCH_API_KEY: Joi.string().allow('').optional(),
  // 撥號時組 callback_url 用（middleware 回呼通話結果），缺漏會導致接聽判定/重試機制失效
  FREESWITCH_CALLBACK_BASE_URL: Joi.string().when('ENABLE_CALL_SCHEDULE', {
    is: 'true',
    then: Joi.when('TELEPHONE_EQUIPMENT', { is: 'FreeSwitch', then: Joi.required(), otherwise: Joi.allow('') }),
    otherwise: Joi.allow(''),
  }),

  // FIAS Middleware（Lakeshore Check-in/Check-out 用）：freeSwitchPmsApi.ts 以字串模板讀值，
  // 未設定會變成 "undefined" 字串送出，故選 FreeSwitch 設備時必須明確設定
  FREESWITCH_PMS_API_URL: Joi.string().allow('').optional(),
  FREESWITCH_PMS_API_KEY: Joi.string().when('ENABLE_CALL_SCHEDULE', {
    is: 'true',
    then: Joi.when('TELEPHONE_EQUIPMENT', { is: 'FreeSwitch', then: Joi.required(), otherwise: Joi.allow('') }),
    otherwise: Joi.allow(''),
  }),
  FREESWITCH_PMS_DOMAIN_NAME: Joi.string().when('ENABLE_CALL_SCHEDULE', {
    is: 'true',
    then: Joi.when('TELEPHONE_EQUIPMENT', { is: 'FreeSwitch', then: Joi.required(), otherwise: Joi.allow('') }),
    otherwise: Joi.allow(''),
  }),

  FIAS_PMS_HOST: Joi.string().when('ENABLE_CALL_SCHEDULE', {
    is: 'true',
    then: Joi.when('ENABLE_FIAS', {
      is: 'false',
      then: Joi.allow(''),
      otherwise: Joi.when('FIAS_MODE', { is: 'client', then: Joi.required(), otherwise: Joi.allow('') }),
    }),
    otherwise: Joi.allow(''),
  }),
  FIAS_PMS_PORT: Joi.string().when('ENABLE_CALL_SCHEDULE', {
    is: 'true',
    then: Joi.when('ENABLE_FIAS', {
      is: 'false',
      then: Joi.allow(''),
      otherwise: Joi.when('FIAS_MODE', { is: 'client', then: Joi.required(), otherwise: Joi.allow('') }),
    }),
    otherwise: Joi.allow(''),
  }),
});

// 缺漏變數依此分組印出，順序即為報錯時的顯示順序
const VAR_GROUPS: [string, string[]][] = [
  ['通用設定', ['CLIENT_ID', 'ENABLE_OUTBOUND_CAMPAIGN', 'ENABLE_CALL_SCHEDULE']],
  ['自動外播 Outbound Campaign', [
    'BONSALE_HOST', 'BONSALE_X_API_KEY', 'BONSALE_X_API_SECRET',
    'HTTP_HOST_3CX', 'WS_HOST_3CX',
    'HTTP_HOST_MESSAGE_FOR_AI', 'POST_9000_BASIC_AUTH',
  ]],
  ['自動語音通知 Call Schedule', ['TELEPHONE_EQUIPMENT']],
  ['自動語音通知 Call Schedule → NewRock', ['NEW_ROCK_API_HOST', 'NEW_ROCK_API_PATH', 'NEW_ROCK_API_MONITOR_PORT']],
  ['自動語音通知 Call Schedule → Yeastar', [
    'YEASTAR_API_HOST', 'YEASTAR_API_PATH', 'YEASTAR_USERNAME', 'YEASTAR_PASSWORD',
  ]],
  ['自動語音通知 Call Schedule → FreeSwitch', ['FREESWITCH_API_URL', 'FREESWITCH_CALLBACK_BASE_URL', 'FREESWITCH_PMS_API_KEY', 'FREESWITCH_PMS_DOMAIN_NAME']],
  ['FIAS PMS 整合', ['FIAS_PMS_HOST', 'FIAS_PMS_PORT']],
];

/**
 * 依目前的 feature flag / 設備 / FIAS 模式驗證 process.env，
 * 缺漏或填錯會一次列出並終止服務（process.exit(1)）。
 */
export function validateEnv(): void {
  const { error } = schema.validate(process.env, { abortEarly: false, allowUnknown: true });
  if (!error) return;

  const invalidVars = new Set(error.details.map((detail) => String(detail.path[0])));

  console.error('[FATAL] 環境變數設定不完整或有誤，請檢查 .env 檔案後重新啟動：\n');
  for (const [group, vars] of VAR_GROUPS) {
    const missing = vars.filter((name) => invalidVars.has(name));
    if (missing.length === 0) continue;
    console.error(`  ${group}：`);
    for (const name of missing) {
      console.error(`    - ${name}`);
    }
  }
  console.error('\n詳細規則請參考 apps/backend/.env.example');
  process.exit(1);
}
