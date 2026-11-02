# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Quick Commands

### Development
```bash
pnpm install              # Install all dependencies
pnpm dev                  # Run backend & frontend in dev mode
pnpm backend              # Run backend only (Node.js on port 4020)
pnpm frontend             # Run frontend only (Vite on port 4030)
pnpm type-check           # TypeScript validation
pnpm lint                 # ESLint check
pnpm lint:fix             # ESLint with auto-fix
```

### Docker (Local Development)
```bash
pnpm docker:up            # Start docker-compose (backend + frontend)
pnpm docker:down          # Stop docker-compose
docker-compose logs -f    # View live logs
```

### Build & Test
```bash
pnpm build                # Build all packages (Turbo orchestrated)
pnpm test                 # Run tests
pnpm clean                # Clean build artifacts
```

### Single Package Commands
```bash
pnpm -F @monorepo/backend dev     # Backend dev server with auto-reload
pnpm -F @monorepo/backend build   # Compile TypeScript to dist/ (tsc && tsc-alias)
pnpm -F call-schedule-dashboard dev
pnpm -F call-schedule-dashboard build
```

## Project Overview

**自動語音通知 / 飯店叫醒服務**：依排程撥打電話給指定分機，並與飯店 PMS 整合。

1. **排程撥號**：排程存在 SQLite，時間到由 node-schedule 觸發撥號；未接聽可自動重試
2. **電話設備抽象層**：NewRock / Yeastar / FreeSwitch 三種設備，用 `TELEPHONE_EQUIPMENT` 切換，程式碼不需改動
3. **FIAS PMS 整合**：透過 TCP 與飯店 PMS 交換 FIAS 訊息（叫醒 WR/WA、入住退房、語系同步等）
4. **客戶專屬路由**：依 `CLIENT_ID` 掛載客製化 HTTP API（目前有 `lakeshore` 煙波）
5. **前端**：單頁排程管理介面（列表 / 新增 / 編輯 / 刪除 / 立即撥打）

本 repo 由 `bonsale_3cx-outbound-campaign` 拆分出來，已移除 3CX 外播、Bonsale CRM、Redis 相關程式。

### Technology Stack
- **Frontend**: React 19 + Vite + TypeScript + Material-UI 7 + SWR
- **Backend**: Node.js 18+ + Express + TypeScript
- **Data**: SQLite（`better-sqlite3`），檔案位於 `apps/backend/data/call_schedules.db`
- **Scheduling**: `node-schedule`
- **Build**: Turbo monorepo + pnpm workspaces
- **Deployment**: Docker + Docker Compose + GCP Container Registry

### Monorepo Structure
```
apps/backend/src/
  app.ts                         # 入口：validateEnv → 掛路由 → listen → setupCallSchedule()
  shared/
    routes/config.ts             # GET /api/config/timezone
    util/validateEnv.ts          # Joi 驗證所有環境變數（開機時一次列出缺漏）
    util/patchConsole.ts         # console 加時間戳（必須是第一個 import）
  features/call-schedule/
    routes/
      callSchedule.ts            # /api/call-schedule CRUD + immediate-call
      hotel/lakeshore.ts         # /api/v1/lakeshore（CLIENT_ID=lakeshore 才掛載）
    services/
      database.ts                # SQLite schema 與 migration
      callService/
        callScheduleService.ts   # 排程核心（node-schedule）
        phoneApiService.ts       # IPhoneApiService 抽象層，設備切換點
        callMonitorService.ts    # ICallMonitorService 抽象層，監控切換點
        device/                  # newRock / yeastar / freeSwitch 撥號實作
        monitor/
          callMonitorCore.ts     # 共用邏輯（pendingCalls、retry、answer/bye 判定）
          callResultNotifier.ts  # 通話結果 handler 註冊（FIAS WA 回報等）
          device/                # 各設備的通話狀態監控實作
      api/                       # 各設備底層 API client、PMS 分機服務
    components/
      fiasHandler.ts             # FIAS 訊息分派
      fiasWakeupResultHandler.ts # 叫醒結果回報 PMS（WA）
    util/
      fias.ts / fiasClient.ts    # FIAS TCP server / client
      fiasLinkProtocol.ts        # FIAS link 協定（LS/LD/LR/LA）
      timezone.ts                # getSiteTimezone()

apps/frontend/src/
  features/call-schedule/        # 排程頁面、對話框、API
  shared/                        # Layout、Navbar、Router、theme、config API
```

## Important Patterns & Conventions

### Startup Order (`app.ts`)
1. `import './shared/util/patchConsole'` 必須是第一行（內含 `dotenv.config()`）
2. 其餘模組靜態 import
3. `validateEnv()`：缺漏或填錯會列出並 `process.exit(1)`
4. 掛載路由 → 404 handler → error handler
5. `app.listen` 後執行 `setupCallSchedule()`：DB → 設備 init → 恢復排程 → 啟動監控 → FIAS

**模組載入時不可 throw**：call-schedule 模組是靜態 import，會在 `validateEnv()` 之前就被載入。模組頂層只能把 env 讀成常數，不能在載入時就因為 env 缺漏而 throw；需要驗證的邏輯放在函式裡延後執行（參考 `phoneApiService.ts` 的 `getDevice()`）。

### Timezone
- `SITE_TIMEZONE`（IANA，例如 `Asia/Taipei`）為**必填**，`validateEnv` 會驗證格式
- DB 與 API 的 `date` 一律為 UTC ISO 8601（`Z` 結尾），顯示時才依 `SITE_TIMEZONE` 轉換
- 前端透過 `GET /api/config/timezone` 取得時區
- `LOG_TIMEZONE` 只影響 log 時間戳，與業務時區無關

### Adding a New Phone Device
1. `services/callService/device/` 實作 `IPhoneApiService`
2. `services/callService/monitor/device/` 實作 `ICallMonitorService`
3. 加入 `phoneApiService.ts` 與 `callMonitorService.ts` 的 device map
4. `validateEnv.ts` 加入該設備的必填變數，並更新 `apps/backend/.env.example`

### Adding a Customer-Specific Route
在 `app.ts` 的 `switch (CLIENT_ID)` 加一個 case，路由檔放在 `routes/hotel/`。若需要非 FIAS 規格的客製化通話結果通知，在 `setupCallSchedule()` 另外 `registerCallResultHandler()`。

### FIAS
- `FIAS_MODE=server`（預設）：我方開 TCP server 等 PMS 連入（port `FIAS_PORT`，預設 4021）
- `FIAS_MODE=client`：我方主動連 PMS（`FIAS_PMS_HOST` / `FIAS_PMS_PORT`）
- `ENABLE_FIAS=false`：完全不開 TCP（Cloud Run 等單 port 環境）
- 詳見 `docs/FIAS_INTEGRATION.md`

### Concurrency
Node.js 是單執行緒，但 `await` 之間其他事件仍可插入。`callMonitorCore.ts` 曾因同分機短時間內重疊來電而遺失通話結果（已改用佇列追蹤同分機的多通電話），修改 pendingCalls 相關邏輯前請先讀 `docs/CALL_SCHEDULE_PENDING_CALLS_RACE_CONDITION.md`。

### TypeScript Paths
- `@/*` → `apps/backend/src/*`
- `@call-schedule/*` → `apps/backend/src/features/call-schedule/*`
- `@shared-local/*` → `apps/backend/src/shared/*`
- Frontend：`@call-schedule` / `@shared`（見 `vite.config.ts`）

**Production Build Note**: Path aliases are resolved at build time by `tsc-alias` (runs after `tsc`). The `build` script is `tsc && tsc-alias` — never just `tsc` alone, or aliases will remain unresolved in `dist/` and cause `Cannot find module` errors at runtime.

## Environment Configuration

完整變數清單、必填條件與預設值以 **`apps/backend/.env.example`** 為準。

- `pnpm backend` 讀 `apps/backend/.env`
- Docker Compose 讀專案根目錄的 `.env`

最少需要：
```bash
CLIENT_ID=demo
SITE_TIMEZONE=Asia/Taipei
TELEPHONE_EQUIPMENT=NewRock   # NewRock | Yeastar | FreeSwitch，並填入對應設備的必填變數
```

## Ports

| Port | 用途 |
|------|------|
| 4020 | Backend HTTP API |
| 4021 | FIAS TCP server（`FIAS_MODE=server`） |
| 4022 | NewRock 事件 Push 接收（`TELEPHONE_EQUIPMENT=NewRock`） |
| 4030 | Frontend |

## Testing

- Backend uses Jest (minimal test setup currently)
- No dedicated frontend test suite yet
- `pnpm type-check` + `pnpm lint` are the primary quality gates

## Deployment

本機 `docker build` + `docker push`（不要用 `gcloud builds submit`，會上傳整個 source 目錄含 `.env`）：
```bash
pnpm deploy:backend      # gcr.io/drvet-server-sysstore-bonvies/bonvies_call-schedule_backend:latest
pnpm deploy:frontend     # gcr.io/drvet-server-sysstore-bonvies/bonvies_call-schedule_frontend:latest
```
VM 上以 `docker-compose.prod.yml` 拉取並啟動。SQLite 存在 `sqlite_data` volume（掛載於 `/app/apps/backend/data`），重建容器不會遺失排程。

## Key Files Reference

| File | Purpose |
|------|---------|
| `apps/backend/src/app.ts` | 啟動流程、路由掛載、FIAS 初始化 |
| `apps/backend/src/shared/util/validateEnv.ts` | 環境變數驗證規則 |
| `apps/backend/.env.example` | 環境變數說明（必填／條件必填／選填） |
| `apps/backend/src/features/call-schedule/services/callService/callScheduleService.ts` | 排程核心 |
| `apps/backend/src/features/call-schedule/services/callService/phoneApiService.ts` | 設備切換點（撥號） |
| `apps/backend/src/features/call-schedule/services/callService/callMonitorService.ts` | 設備切換點（監控） |
| `apps/backend/src/features/call-schedule/services/callService/monitor/callMonitorCore.ts` | 通話監控共用邏輯 |
| `apps/backend/src/features/call-schedule/components/fiasHandler.ts` | FIAS 訊息處理 |
| `apps/backend/src/features/call-schedule/services/database.ts` | SQLite schema |
| `docs/FIAS_INTEGRATION.md` | FIAS 整合說明 |
