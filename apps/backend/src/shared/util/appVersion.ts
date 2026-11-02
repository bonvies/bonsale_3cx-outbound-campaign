import { readFileSync } from 'fs';
import path from 'path';

// 版號以 apps/backend/package.json 為準，升版請用根目錄的 `pnpm bump`。
// dev 時 __dirname 是 src/shared/util，build 後是 dist/shared/util，兩者都在 apps/backend 下三層。
// 不用 import package.json：tsconfig 的 rootDir 是 ./src，引入 src 外的檔案 tsc 會報錯。
const packageJsonPath = path.join(__dirname, '../../../package.json');

export const APP_VERSION: string = JSON.parse(readFileSync(packageJsonPath, 'utf8')).version;
