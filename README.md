# 📱 Bonsale 3CX 自動外撥活動系統

**版本：v1.0.6**

一個整合 3CX 電話系統與 Bonsale CRM 的自動外撥活動管理平台。透過技術自動化地進行大規模電話外撥，並與 CRM 系統即時同步所有通話記錄。

## ✨ 核心特色

- ✅ 支援同時執行多個外撥活動
- ✅ 3CX WebSocket 實時監聽電話狀態
- ✅ 與 Bonsale CRM 雙向整合
- ✅ 自動 Token 刷新管理
- ✅ 支援多分機/多員工並發撥號
- ✅ 時間排程與限制支援
- ✅ 撥打自動恢復機制
- ✅ 實時儀表板監控

## 🏗️ 專案架構

本專案採用 **Monorepo** 結構，使用 Docker Compose 容器化部署：

```
bonsale_3cx-outbound-campaign/
├── apps/
│   ├── backend/                 # Node.js + TypeScript API 服務
│   │   ├── src/
│   │   ├── Dockerfile
│   │   └── package.json
│   └── frontend/                # React + Vite 前端應用
│       ├── src/
│       ├── Dockerfile
│       └── package.json
├── packages/
│   └── shared-types/            # 共用型別定義
├── docker-compose.yml           # 開發環境配置
├── docker-compose.prod.yml      # 生產環境配置
└── .env                         # 環境變數配置（需自行建立）
```

## 🔧 環境需求

### 開發環境

- **Node.js**: 18.0 以上
- **pnpm**: 包管理器
- **Docker & Docker Compose**: 容器化運行

### 生產環境

- **GCP 專案**（啟用 Container Registry）
- **GCP Compute Engine VM**: 用於運行容器
- **Docker & Docker Compose**: 容器運行環境

## 🌍 環境變數配置

### 必需的環境變數

在專案根目錄建立 `.env` 檔案，包含以下設定項（具體參數請洽專案維護者）：

```bash
# 3CX 系統連接
HTTP_HOST_3CX=<3CX_SERVER_URL>
WS_HOST_3CX=<3CX_WEBSOCKET_URL>

# 應用服務設定
HTTP_PORT=4020
NODE_ENV=production

# 是否啟用完整日誌輸出 (true/false)
IS_FULL_LOG=false

# 服務器重啟時是否自動恢復撥打任務 (true/false)
AUTO_RECOVER_ON_RESTART=true

# Bonsale API 連接
BONSALE_HOST=<BONSALE_API_ENDPOINT>
BONSALE_X_API_KEY=<YOUR_API_KEY>
BONSALE_X_API_SECRET=<YOUR_API_SECRET>

# AI 自動外撥參數
HTTP_HOST_MESSAGE_FOR_AI=<MESSAGE_SERVICE_URL>

# 呼叫類型支援（Wqueue, Wextension, Wroutepoint）
DEFAULT_SUPPORTED_CALL_TYPES=Wextension

# 空閒檢查設定（啟用後當撥號名單太久沒撥號，系統自動嘗試恢復）
IS_STARTIDLECHECK=true
IDLE_CHECK_INTERVAL=30000
MIN_IDLE_CHECK_INTERVAL=30000
MAX_IDLE_CHECK_INTERVAL=300000
IDLE_CHECK_BACKOFF_FACTOR=1.5

# 3CX 管理員認證
ADMIN_3CX_CLIENT_ID=<CLIENT_ID>
ADMIN_3CX_CLIENT_SECRET=<CLIENT_SECRET>
ADMIN_3CX_GRANT_TYPE=client_credentials

# Redis 連接
REDIS_URL=redis://redis:6379
```

## 🚀 快速開始

### 本地開發環境

```bash
# 1. 安裝依賴
pnpm install

# 2. 建立 .env 檔案（參考上面的環境變數配置）
cp apps/backend/.env.example apps/backend/.env
# 編輯 .env 填入具體參數

# 3. 啟動開發環境
docker-compose up -d

# 4. 查看服務狀態
docker-compose ps

# 5. 訪問應用
# - 前端：http://localhost:4030
# - 後端 API：http://localhost:4020
# - Redis Commander：http://localhost:8081
```

### 本地開發日誌查看

```bash
# 查看所有服務日誌
docker-compose logs -f

# 查看特定服務日誌
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f redis
```

## 📦 生產環境部署

### 前置準備

1. **GCP 認證設定**

```bash
gcloud auth login
gcloud config set project <YOUR_GCP_PROJECT_ID>
gcloud auth configure-docker gcr.io
```

2. **建立 Docker 映像檔**

```bash
# 建立後端映像檔（指定 Linux/AMD64 架構）
docker build --platform linux/amd64 \
  -f apps/backend/Dockerfile \
  -t gcr.io/<YOUR_PROJECT>/bonsale_3cx-outbound-campaign_backend:latest .

# 建立前端映像檔
docker build --platform linux/amd64 \
  -f apps/frontend/Dockerfile \
  -t gcr.io/<YOUR_PROJECT>/bonsale_3cx-outbound-campaign_frontend:latest .
```

3. **推送到 GCP Container Registry**

```bash
docker push gcr.io/<YOUR_PROJECT>/bonsale_3cx-outbound-campaign_backend:latest
docker push gcr.io/<YOUR_PROJECT>/bonsale_3cx-outbound-campaign_frontend:latest
```

4. **VM 上部署**

在 GCP VM 上執行：

```bash
# 拉取最新映像檔
docker-compose -f docker-compose.prod.yml pull

# 啟動服務
docker-compose -f docker-compose.prod.yml up -d

# 驗證服務狀態
docker-compose -f docker-compose.prod.yml ps
```

## 🔧 常用管理命令

### 服務管理

```bash
# 查看服務狀態
docker-compose -f docker-compose.prod.yml ps

# 查看即時日誌
docker-compose -f docker-compose.prod.yml logs -f

# 查看特定服務日誌
docker-compose -f docker-compose.prod.yml logs backend

# 重啟特定服務
docker-compose -f docker-compose.prod.yml restart backend

# 停止所有服務
docker-compose -f docker-compose.prod.yml down

# 重新啟動整個專案
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d
```

### 環境變數更新

修改 `.env` 後，重啟相關服務以應用變更：

```bash
nano .env
docker-compose -f docker-compose.prod.yml restart backend
```

## 📝 更新流程

1. 修改程式碼並本地測試
2. 建立新的 Docker 映像檔
3. 推送到 GCP Container Registry
4. 在 VM 上拉取新映像並重啟服務

```bash
# 本地：建立並推送映像檔
docker build --platform linux/amd64 \
  -f apps/backend/Dockerfile \
  -t gcr.io/<YOUR_PROJECT>/bonsale_3cx-outbound-campaign_backend:latest .
docker push gcr.io/<YOUR_PROJECT>/bonsale_3cx-outbound-campaign_backend:latest

# VM 上：更新服務
docker-compose -f docker-compose.prod.yml pull backend
docker-compose -f docker-compose.prod.yml up -d backend
```

## 📚 技術棧

| 層級 | 技術 |
|------|------|
| **前端** | React + Vite + TypeScript |
| **後端** | Node.js + Express + TypeScript |
| **資料庫** | Redis (快取與狀態管理) |
| **容器化** | Docker + Docker Compose |
| **通訊** | WebSocket (實時更新) + REST API |
| **託管** | Google Cloud Platform (GCP) |

## 🐛 故障排查

### 後端無法連接 3CX

- 檢查 `HTTP_HOST_3CX` 和 `WS_HOST_3CX` 是否正確
- 驗證 3CX 管理員認證參數
- 檢查防火牆規則是否允許出站連接

### Redis 連接失敗

```bash
# 檢查 Redis 服務狀態
docker-compose ps redis

# 進入 Redis 容器測試連接
docker exec -it bonsale_3cx-outbound-campaign_redis redis-cli ping
```

### 前端無法訪問

- 驗證前端容器是否正常運行：`docker-compose ps frontend`
- 檢查埠口 4030 是否被佔用
- 確認後端 API 地址是否正確配置
