# Docker Compose 本地開發環境設置指南

本文檔提供使用 `docker-compose.full-local.yml` 設置完整本地開發環境的操作步驟。

## 目錄

- [系統要求](#系統要求)
- [環境準備](#環境準備)
- [啟動服務](#啟動服務)
- [驗證服務](#驗證服務)
- [常見問題](#常見問題)
- [服務清理](#服務清理)

---

## 系統要求

- Docker Desktop (含 Docker Compose)
- 至少 8GB RAM
- 至少 50GB 硬碟空間（用於 MySQL 數據和 SQL 初始化）

## 環境準備

### 1. 確保 SQL 文件存在

```bash
# 檢查 SQL 文件是否存在於項目根目錄
ls -lh demo_Leo_Cloud_SQL_Export_2025-11-28.sql
```

SQL 文件應該大約 **641 MB**，包含完整的 `demo_drvet_server` 資料庫定義。

### 2. 檢查環境變數文件

確保以下環境文件存在且配置正確：

```bash
# 檢查環境文件
ls -l mysql.env telesale-api.env fe-bonsale.env full-local.env
```

**重要配置檢查：**

| 文件 | 關鍵配置 | 說明 |
|------|---------|------|
| `mysql.env` | `MYSQL_DATABASE=demo_drvet_server` | MySQL 初始化資料庫名稱 |
| `telesale-api.env` | `client_name=demo` | Telesale API 客戶端名稱 |
| `telesale-api.env` | `mysql_db_name=demo_drvet_server` | Telesale API 連接的資料庫 |
| `fe-bonsale.env` | `VITE_APP_CLIENT_NAME=demo` | 前端使用的客戶端名稱（須與 telesale-api 匹配） |
| `full-local.env` | `BONSALE_HOST=http://telesale-api:8089/service` | Backend 連接 Telesale API 的地址（須使用服務名，不能用 localhost） |
| `full-local.env` | `REDIS_URL=redis://redis:6379` | Backend 連接 Redis 的地址（須使用服務名，不能用 localhost） |

---

## 啟動服務

### 基本啟動

```bash
# 進入項目目錄
cd /Users/leo/Desktop/Program/Project/bonsale_3cx-outbound-campaign/code/bonsale_3cx-outbound-campaign

# 啟動所有服務
docker-compose -f docker-compose.full-local.yml up -d
```

### 啟動過程

Docker Compose 會按以下順序啟動服務：

1. **Redis** - 立即啟動
2. **MySQL** - 啟動後開始 SQL 初始化（**耗時 15-20 分鐘**）
3. **Redis Commander** - 立即啟動
4. **Telesale API** - 等待 MySQL healthcheck 通過後啟動
5. **Frontend (fe-bonsale)** - 等待 Telesale API 啟動後啟動
6. **Backend** - 等待 Telesale API 和 Redis 健康後啟動

### 監控啟動進度

```bash
# 查看所有容器狀態
docker ps --format "table {{.Names}}\t{{.Status}}"

# 監控 MySQL 初始化進度
docker logs -f bonsale_3cx-outbound-campaign_mysql

# 查看特定容器日誌
docker logs -f bonsale_3cx-outbound-campaign_backend
docker logs -f telesale_api
docker logs -f bonsale_3cx-outbound-campaign_frontend
```

### 關鍵日誌標記

**MySQL 初始化完成的標記：**

```
[Note] [Entrypoint]: running /docker-entrypoint-initdb.d/init.sql
（約 15-20 分鐘後）
[Note] [Entrypoint]: MySQL init process done. Ready for start up.
[System] [MY-010931] [Server] ready for connections. Port: 3306
```

---

## 驗證服務

### 1. 檢查容器健康狀態

```bash
# 所有容器應該是 "Up" 狀態
docker ps
```

期望結果：

```
NAMES                                    STATUS
bonsale_3cx-outbound-campaign_mysql      Up XX minutes (healthy)
bonsale_3cx-outbound-campaign_redis      Up XX minutes (healthy)
telesale_api                             Up XX minutes
bonsale_3cx-outbound-campaign_backend    Up XX minutes
bonsale_3cx-outbound-campaign_frontend   Up XX minutes
fe-bonsale                               Up XX minutes
```

### 2. 測試 MySQL 連接

```bash
# 進入 MySQL 容器驗證
docker exec bonsale_3cx-outbound-campaign_mysql mysql -uroot -proot -e "SHOW DATABASES;"

# 驗證資料庫和表
docker exec bonsale_3cx-outbound-campaign_mysql mysql -uroot -proot -e "USE demo_drvet_server; SELECT COUNT(*) as table_count FROM information_schema.tables;"
```

期望結果：應有 1000+ 個表。

### 3. 測試 API 連接

```bash
# 測試 Telesale API
curl -I http://localhost:8089/api/v5/member

# 測試 Frontend
curl -I http://localhost:8090/login

# 測試 Backend
curl -I http://localhost:4020/health
```

### 4. 訪問 Web 服務

| 服務 | URL | 說明 |
|------|-----|------|
| **Fe-Bonsale** | http://localhost:8090 | 前端登入頁面 |
| **Redis Commander** | http://localhost:8081 | Redis 管理工具 |
| **Backend API** | http://localhost:4020 | 後端服務 |
| **Telesale API** | http://localhost:8089 | Telesale 服務 |

---

## 常見問題

### Q1: MySQL 初始化卡住或很慢

**症狀：** 看到 `running /docker-entrypoint-initdb.d/init.sql` 但之後沒有進展

**解決方案：**
- SQL 文件大 (641 MB)，需要 15-20 分鐘初始化
- 檢查機器剩餘空間和 RAM
- 查看 MySQL 日誌確認沒有錯誤

```bash
docker logs bonsale_3cx-outbound-campaign_mysql | tail -50
```

### Q2: Telesale API 無法連接 MySQL

**症狀：** telesale_api 容器不斷重啟，日誌顯示 `connect: connection refused`

**原因：** MySQL healthcheck 失敗或 MySQL 還在初始化

**解決方案：**
1. 等待 MySQL 初始化完成（監控日誌）
2. 確認 MySQL healthcheck 命令有正確的密碼

```bash
# 檢查 MySQL healthcheck 狀態
docker inspect bonsale_3cx-outbound-campaign_mysql --format='{{json .State.Health}}' | jq .
```

### Q3: Backend 無法連接 Telesale API

**症狀：** Backend 日誌顯示 `Error: connect ECONNREFUSED 127.0.0.1:8089`

**原因：** `full-local.env` 中使用了 `localhost` 或 `127.0.0.1`，在 Docker 容器內指向容器本身

**解決方案：** 更新 `full-local.env`

```env
# ❌ 錯誤
BONSALE_HOST=http://localhost:8089/service
REDIS_URL=redis://localhost:6379

# ✅ 正確
BONSALE_HOST=http://telesale-api:8089/service
REDIS_URL=redis://redis:6379
```

然後重啟 backend：

```bash
docker restart bonsale_3cx-outbound-campaign_backend
```

### Q4: Fe-Bonsale 登入 Token 無效

**症狀：** 登入時顯示 `Without secret, invalid key: staging`

**原因：** Fe-Bonsale 的 `client_name` 與 Telesale API 配置不匹配

**解決方案：** 更新 `fe-bonsale.env`

```env
# 確保與 telesale-api.env 中的 client_name=demo 一致
VITE_APP_CLIENT_NAME=demo
```

重啟 fe-bonsale：

```bash
docker restart fe-bonsale
```

### Q5: 完全重新初始化

**場景：** 需要清空所有數據重新開始

```bash
# 停止所有容器並刪除 volume
docker-compose -f docker-compose.full-local.yml down -v

# 重新啟動（會重新初始化 MySQL）
docker-compose -f docker-compose.full-local.yml up -d
```

**警告：** 此操作會刪除所有 MySQL 數據，需要重新執行 SQL 初始化。

### Q6: 保存容器狀態但停止服務

**場景：** 只想暫停服務，保留所有數據

```bash
# 停止容器但保留 volume
docker-compose -f docker-compose.full-local.yml down

# 重新啟動（MySQL 數據保留，無需重新初始化）
docker-compose -f docker-compose.full-local.yml up -d
```

---

## 服務清理

### 停止所有服務

```bash
# 保留數據
docker-compose -f docker-compose.full-local.yml down

# 刪除所有數據（包括 MySQL volume）
docker-compose -f docker-compose.full-local.yml down -v
```

### 查看和刪除 Volumes

```bash
# 列出所有 volume
docker volume ls | grep bonsale

# 查看 volume 詳細信息
docker volume inspect mysql_data

# 手動刪除 volume
docker volume rm mysql_data redis_data
```

### 清理 Docker 系統

```bash
# 刪除未使用的容器、網路、image
docker system prune

# 刪除未使用的 volume
docker system prune --volumes

# 完整清理（包括正在使用的）
docker system prune -a --volumes
```

---

## Docker Compose 配置說明

### docker-compose.full-local.yml 的關鍵配置

#### MySQL 服務

```yaml
mysql:
  image: mysql:8.0
  env_file:
    - mysql.env
  volumes:
    - mysql_data:/var/lib/mysql
    - ./demo_Leo_Cloud_SQL_Export_2025-11-28.sql:/docker-entrypoint-initdb.d/init.sql
  healthcheck:
    test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-proot"]
    start_period: 600s  # 給 SQL 初始化足夠時間（10 分鐘）
```

**重點：**
- `start_period: 600s` - healthcheck 等待 10 分鐘讓 SQL 初始化完成
- SQL 文件自動在 `/docker-entrypoint-initdb.d/init.sql` 執行

#### Telesale API 服務

```yaml
telesale-api:
  depends_on:
    mysql:
      condition: service_healthy
```

**重點：**
- 等待 MySQL healthcheck 通過才啟動
- 確保 MySQL 初始化完全完成後再連接

#### Backend 服務

```yaml
backend:
  depends_on:
    telesale-api:
      condition: service_started
    redis:
      condition: service_healthy
```

**重點：**
- 等待 Telesale API 和 Redis 就緒後才啟動

---

## Docker 網路

所有服務連接到 `bonsale-network` 網路，服務間可直接使用**服務名**通訊：

```
Backend → Telesale API: http://telesale-api:8089
Backend → Redis: redis://redis:6379
Telesale API → MySQL: mysql:3306
```

**重要：** 在 Docker 容器內，不能使用 `localhost` 或 `127.0.0.1` 連接其他容器！

---

## 快速命令參考

```bash
# 啟動所有服務
docker-compose -f docker-compose.full-local.yml up -d

# 停止服務（保留數據）
docker-compose -f docker-compose.full-local.yml down

# 完整清理（刪除數據）
docker-compose -f docker-compose.full-local.yml down -v

# 查看容器狀態
docker ps

# 查看服務日誌
docker logs -f <container_name>

# 重啟單個服務
docker restart <container_name>

# 進入容器執行命令
docker exec -it <container_name> bash

# 查看網路配置
docker network inspect bonsale_3cx-outbound-campaign_bonsale-network

# 查看 volume 狀態
docker volume ls
docker volume inspect mysql_data
```

---

## 新增或修改環境變數

修改任何 `.env` 文件後，需要重啟相應的容器：

```bash
# 修改了 full-local.env
docker restart bonsale_3cx-outbound-campaign_backend

# 修改了 fe-bonsale.env
docker restart fe-bonsale

# 修改了 telesale-api.env
docker restart telesale_api

# 或重啟所有服務
docker-compose -f docker-compose.full-local.yml restart
```

---

## 性能優化建議

### 增加 Docker 資源限制

如果機器資源充足，在 Docker Desktop 設置中增加：
- **CPU:** 至少 4 核心
- **RAM:** 至少 6-8 GB
- **磁碟:** 至少 50 GB

### MySQL 性能

如果 SQL 初始化太慢，可以考慮：
1. 增加 Docker 分配給 MySQL 的 RAM
2. 檢查系統磁碟 I/O 性能
3. 確認沒有其他程序占用系統資源

---

## 故障排查步驟

1. **檢查所有容器狀態**
   ```bash
   docker ps -a
   ```

2. **查看容器日誌**
   ```bash
   docker logs <container_name> | tail -100
   ```

3. **檢查網路連接**
   ```bash
   docker exec <container_name> ping <service_name>
   docker exec <container_name> nc -zv <service_name> <port>
   ```

4. **檢查環境變數**
   ```bash
   docker inspect <container_name> | grep -A 20 '"Env"'
   ```

5. **驗證 Volume 掛載**
   ```bash
   docker inspect <container_name> | grep -A 10 '"Mounts"'
   ```

---

## 相關文檔

- [ERROR_HANDLING.md](./ERROR_HANDLING.md) - 錯誤處理指南
- [WEBSOCKET_FORMAT.md](./WEBSOCKET_FORMAT.md) - WebSocket 協議規範
- [CLAUDE.md](../CLAUDE.md) - 專案架構和開發指南

---

**最後更新：** 2025-12-01
**文檔版本：** 1.0
