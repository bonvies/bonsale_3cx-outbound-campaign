import Joi from 'joi';

// 驗證必填的環境變數是否存在。詳細分類請見 apps/backend/.env.example。
const schema = Joi.object({
  CLIENT_ID: Joi.string().required(),

  BONSALE_HOST: Joi.string().required(),
  BONSALE_X_API_KEY: Joi.string().required(),
  BONSALE_X_API_SECRET: Joi.string().required(),
  HTTP_HOST_3CX: Joi.string().required(),
  WS_HOST_3CX: Joi.string().required(),
  HTTP_HOST_MESSAGE_FOR_AI: Joi.string().required(),
  POST_9000_BASIC_AUTH: Joi.string().required(),
});

// 缺漏變數依此分組印出，順序即為報錯時的顯示順序
const VAR_GROUPS: [string, string[]][] = [
  ['必填設定', [
    'CLIENT_ID',
    'BONSALE_HOST', 'BONSALE_X_API_KEY', 'BONSALE_X_API_SECRET',
    'HTTP_HOST_3CX', 'WS_HOST_3CX',
    'HTTP_HOST_MESSAGE_FOR_AI', 'POST_9000_BASIC_AUTH',
  ]],
];

/**
 * 驗證 process.env，缺漏或填錯會一次列出並終止服務（process.exit(1)）。
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
