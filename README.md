# 📞 Bonvies 自動語音通知系統（Call Schedule）

**版本：v3.0.2**

依排程自動撥打語音通知的服務，支援多種電話設備，並可透過 FIAS 協定與飯店 PMS 整合，提供叫醒服務、入住退房分機權限同步等功能。

> 本專案由 `bonsale_3cx-outbound-campaign` 拆分而來，只保留自動語音通知（Call Schedule）功能。

## ✨ 核心特色

### 自動語音通知
- ✅ 排程自動撥打，重啟後自動恢復未執行的排程
- ✅ 未接聽自動重試（可設定次數與間隔）
- ✅ 支援 NewRock / Yeastar / FreeSwitch 三種電話設備，透過環境變數切換，不需改程式碼
- ✅ 管理介面：排程列表、篩選、新增、編輯、刪除、立即撥打

### FIAS PMS 整合（飯店叫醒服務）
- ✅ 以 FIAS 協定與 PMS 雙向通訊
- ✅ **Server 模式**：我方開 TCP Server，等 PMS 連入
- ✅ **Client 模式**：我方主動連至 PMS TCP Server（例如 FidServ Socket Server）
- ✅ 叫醒結果自動回報 PMS（WA）
- ✅ 房號自動轉分機號（可設定前綴）

### 客戶專屬整合
- ✅ 依 `CLIENT_ID` 掛載客製化 API（目前：Lakeshore 煙波飯店的房態、入住、退房、資料更新）

## 🏗️ 專案架構

```
bonvies_call-schedule/
├── apps/
│   ├── backend/                       # Node.js + Express + TypeScript
│   │   ├── src/
│   │   │   ├── app.ts                 # 啟動流程與路由掛載
│   │   │   ├── shared/                # 環境變數驗證、設定 API、log 時間戳
│   │   │   └── features/call-schedule/
│   │   │       ├── routes/            # callSchedule.ts、hotel/lakeshore.ts
│   │   │       ├── services/          # 排程、SQLite、設備撥號與監控抽象層
│   │   │       ├── components/        # FIAS 訊息處理
│   │   │       └── util/              # FIAS TCP server/client、時區
│   │   ├── data/                      # SQLite 資料庫（不進版控）
│   │   ├── .env.example               # 環境變數說明
│   │   └── Dockerfile
│   └── frontend/                      # React + Vite 管理介面
│       ├── src/
│       └── Dockerfile
├── docs/                              # FIAS 整合、問題分析文件
├── docker-compose.yml                 # 本地開發
└── docker-compose.prod.yml            # 生產環境
```

## 🔧 環境需求

- **Node.js** 18 以上
- **pnpm**
- **Docker & Docker Compose**
- 生產環境：GCP 專案（Container Registry）+ Compute Engine VM

## 🌍 環境變數

完整清單、必填條件與預設值請見 **`apps/backend/.env.example`**。啟動時會自動驗證，缺漏或填錯會在開機當下一次列出並終止服務。

- 本機 `pnpm backend`：讀 `apps/backend/.env`
- Docker Compose：讀專案根目錄的 `.env`

### 通用（必填）

```bash
CLIENT_ID=demo                  # 客戶識別；lakeshore 會額外掛載煙波專屬 API
SITE_TIMEZONE=Asia/Taipei       # 站點時區（IANA 格式），排程與顯示皆以此為準
TELEPHONE_EQUIPMENT=NewRock     # NewRock | Yeastar | FreeSwitch
```

### 電話設備（依 `TELEPHONE_EQUIPMENT` 擇一必填）

```bash
# NewRock
NEW_ROCK_API_HOST=<YOUR_NEW_ROCK_API_HOST>
NEW_ROCK_API_PATH=/xml
NEW_ROCK_API_MONITOR_PORT=4022

# Yeastar
YEASTAR_API_HOST=<YOUR_YEASTAR_API_HOST>
YEASTAR_API_PATH=/openapi/v1.0
YEASTAR_USERNAME=<YOUR_YEASTAR_USERNAME>
YEASTAR_PASSWORD=<YOUR_YEASTAR_PASSWORD>

# FreeSwitch
FREESWITCH_API_URL=<PY_DIALER_URL>
FREESWITCH_CALLBACK_BASE_URL=<本服務對外網址>
FREESWITCH_PMS_API_KEY=<YOUR_FREESWITCH_PMS_API_KEY>
FREESWITCH_PMS_DOMAIN_NAME=<YOUR_FUSIONPBX_DOMAIN_NAME>
```

### FIAS PMS 整合

```bash
ENABLE_FIAS=true                # 設 false 則不開 TCP（適合 Cloud Run）
FIAS_MODE=server                # server：等 PMS 連入；client：主動連 PMS

# FIAS_MODE=client 時必填
# 範例：FidServ Device Settings → Device Type: Socket Server, Port: 5006
# 注意：PMS 端需勾選「allow new connection」才能接受我方連線
FIAS_PMS_HOST=<PMS_IP_OR_HOSTNAME>
FIAS_PMS_PORT=<PMS_PORT>
```

其餘選填變數（`FIAS_PORT`、`FIAS_ENCODING`、`FIAS_EXTENSION_PREFIX`、`FIAS_WR_MAX_RETRIES`、`LAKESHORE_IP_WHITELIST` 等）請見 `.env.example`。

## 🚀 快速開始

### 本機直接執行

```bash
pnpm install
cp apps/backend/.env.example apps/backend/.env   # 編輯填入實際參數
pnpm dev                                         # 同時啟動前後端
```

### Docker Compose

```bash
cp apps/backend/.env.example .env                # 編輯填入實際參數
pnpm docker:up
```

### 服務位址

| 服務 | 位址 |
|------|------|
| 前端 | http://localhost:4030 |
| 後端 API | http://localhost:4020 |
| FIAS TCP（server 模式） | localhost:4021 |
| NewRock 事件接收 | localhost:4022 |

## 🔌 API

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/config/timezone` | 站點時區 |
| GET | `/api/call-schedule` | 排程列表（分頁、篩選） |
| GET | `/api/call-schedule/:id` | 單筆排程 |
| POST | `/api/call-schedule` | 新增排程 |
| POST | `/api/call-schedule/immediate-call` | 立即撥打 |
| PUT | `/api/call-schedule/:id` | 修改排程 |
| DELETE | `/api/call-schedule/expired` | 刪除過期排程 |
| DELETE | `/api/call-schedule/:id` | 刪除排程 |
| POST | `/api/call-schedule/freeswitch-webhook` | FreeSwitch 通話結果回呼（僅 FreeSwitch） |
| POST | `/api/v1/lakeshore/*` | 煙波專屬 API（僅 `CLIENT_ID=lakeshore`） |

日期欄位一律使用 UTC ISO 8601（`Z` 結尾）。

## 📦 生產環境部署

### 建立並推送映像檔（本機）

```bash
gcloud auth configure-docker gcr.io   # 首次需要

pnpm deploy                           # 後端 + 前端
pnpm deploy:backend                   # 僅後端
pnpm deploy:frontend                  # 僅前端
```

映像檔：
- `gcr.io/drvet-server-sysstore-bonvies/bonvies_call-schedule_backend:latest`
- `gcr.io/drvet-server-sysstore-bonvies/bonvies_call-schedule_frontend:latest`

### VM 上更新

```bash
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d
docker-compose -f docker-compose.prod.yml ps
```

SQLite 存在 `sqlite_data` volume，重建容器不會遺失排程。

### 修改環境變數

```bash
nano .env
docker-compose -f docker-compose.prod.yml up -d backend   # 重新建立容器以套用新的 .env
```

## 📚 技術棧

| 層級 | 技術 |
|------|------|
| **前端** | React 19 + Vite + TypeScript + Material-UI 7 + SWR |
| **後端** | Node.js + Express + TypeScript |
| **資料庫** | SQLite（better-sqlite3） |
| **排程** | node-schedule |
| **電話設備** | NewRock OM API / Yeastar OpenAPI / FreeSwitch（可切換） |
| **PMS 整合** | FIAS 協定（Server / Client 雙模式） |
| **容器化** | Docker + Docker Compose |
| **託管** | Google Cloud Platform |

## 🐛 故障排查

### 啟動時顯示「環境變數設定不完整或有誤」
依畫面列出的變數名稱補齊 `.env`，規則見 `apps/backend/.env.example`。`SITE_TIMEZONE` 必須是合法的 IANA 時區名稱（例如 `Asia/Taipei`）。

### `better-sqlite3` 出現 `NODE_MODULE_VERSION` 不符
原生模組與目前 Node 版本不一致，執行 `pnpm rebuild better-sqlite3`。

### 撥不出電話
- 查看後端日誌是否有 `話機設備初始化失敗`
- 確認 `TELEPHONE_EQUIPMENT` 與對應設備變數正確、網路可達

### FIAS 連線問題
- **Server 模式**：確認防火牆已開放 `FIAS_PORT`（預設 4021）供 PMS 連入
- **Client 模式**：確認 PMS 端已勾選「allow new connection」，且 `FIAS_PMS_HOST` / `FIAS_PMS_PORT` 正確
- 查看後端日誌中 `[FIAS]` 前綴的訊息
- 詳見 `docs/FIAS_INTEGRATION.md`
