/// <reference types="vite/client" />

// 由 vite.config.ts 的 define 在 build 時注入，值來自 apps/frontend/package.json
declare const __APP_VERSION__: string;
