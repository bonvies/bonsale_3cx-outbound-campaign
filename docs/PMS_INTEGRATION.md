# PMS 整合文件

本文件涵蓋自動語音通知（Call Schedule）功能與飯店 PMS 系統的對接說明，包含協定選擇背景、FIAS 完整規格、Nortel PMS 骨架，以及開發方向討論。

---

## 一、系統架構

```
飯店 PMS 系統
      ↓ TCP（PMS_PORT，預設 4021）
  pmsServer.ts（切換點，根據 PMS_PROTOCOL 啟動對應 server）
      ├── FIAS      → util/fias.ts + components/fiasHandler.ts
      └── NortelPMS → util/nortelPms.ts + components/nortelPmsHandler.ts
      ↓
  callScheduleService.ts（排程引擎）
      ↓
  phoneApiService.ts（根據 TELEPHONE_EQUIPMENT 切換設備）
      ├── NewRock → HTTP 1.0 XML API
      └── Yeastar → REST API + WebSocket CDR
      ↓
  房客電話（叫醒服務）
```

---

## 二、協定選擇

市場上存在多套 PMS 對接協定，**互不相容**，須依客戶使用的 PMS 品牌選擇：

| 協定 | 環境變數值 | 訊息格式 | 適用 PMS 品牌 | 實作狀態 |
|------|-----------|---------|-------------|---------|
| **FIAS** | `FIAS` | STX/ETX byte 包住，`\|` 分隔欄位 | Opera、Protel、Fidelio（國際連鎖）| ✅ 完成 |
| **Nortel PMS** | `NortelPMS` | 純文字指令，空格分隔 | ICS&S、Foxhis、Pegasus、ShenOu（亞洲在地）| 🚧 骨架（待規格文件）|
| **Mitel SX-2000** | — | 待確認 | 中型飯店（北美/歐洲）| ❌ 未實作 |

### 切換方式

在 `.env` 設定：
```
PMS_PROTOCOL=FIAS      # 或 NortelPMS
```

---

## 三、FIAS 協定（已完成）

### 3.1 連線資訊

- **協定**：TCP 長連線
- **Port**：`PMS_PORT`（預設 `4021`）
- **編碼**：ASCII
- **訊息格式**：每則訊息以 `STX`（`\x02`）開頭、`ETX`（`\x03`）結尾

```
\x02TYPE|FIELD1VALUE1|FIELD2VALUE2\x03
```

### 3.2 欄位格式規則

- 欄位之間以 `|` 分隔
- 每個欄位由 **2 字元 Key** + **Value** 組成（無額外分隔符）
- 第一段為**訊息類型**（2 字元）

```
WR|RN101|TI0730|DT260312|RI5|MR3
^   ^^        ^^        ^^    ^
類型 RN=101  TI=0730  DT=260312  RI=5  MR=3
```

### 3.3 訊息類型

#### LS — 連線握手（Link Start）

PMS 連線後發送，系統回應日期時間確認。

```
PMS  → 系統：\x02LS\x03
系統 → PMS ：\x02LS|DA<YYMMDD>|TI<HHMMSS>\x03
```

| 回應欄位 | 說明 |
|---------|------|
| `DA` | 當天日期 YYMMDD |
| `TI` | 當前時間 HHMMSS |

---

#### LA — 心跳（Link Alive）

PMS 定期發送，系統直接回應 `LA`。

```
PMS  → 系統：\x02LA\x03
系統 → PMS ：\x02LA\x03
```

---

#### WR — 叫醒預約（Wake-up Request）

PMS 通知系統在指定時間撥打指定房間。

```
PMS → 系統：\x02WR|RN<房號>|TI<時間>|DT<日期>|RI<重試間隔>|MR<最大重試>\x03
```

| 欄位 | 說明 | 格式 | 必填 |
|------|------|------|------|
| `RN` | 房間號碼 | 數字字串，如 `101` | ✅ |
| `TI` | 叫醒時間 | `HHMM`，如 `0730` | ✅ |
| `DT` | 叫醒日期 | `YYMMDD`，如 `260312` | ❌（省略則當天，已過則排明天）|
| `RI` | 未接時重試間隔（分鐘）| 數字字串，如 `5` | ✅ |
| `MR` | 最大重試次數 | 數字字串，如 `3` | ✅ |

**範例：2026/03/26 07:30 叫醒 101 房，每 5 分鐘重試最多 3 次**
```
\x02WR|RN101|TI0730|DT260326|RI5|MR3\x03
```

**系統 → PMS（回應）**
```
\x02WC|RN<房號>|ST<狀態>\x03
```

| `ST` | 說明 |
|------|------|
| `1` | 成功接受預約 |
| `0` | 失敗 |

**叫醒流程**
```
WR 接收
  └─▶ 寫入 call_schedules（callStatus: 排程中）
        └─▶ 到時間撥打電話（callStatus: 撥打中）
              ├─▶ 響鈴中
              ├─▶ 已接聽 ─────────────────────── 結束
              └─▶ 未接聽 → 等待 RI 分鐘後重試
                    └─▶ 重試 n/MR
                          ├─▶ 已接聽 ──────────── 結束
                          └─▶ 達到 MR → 未接聽 ── 結束
```

---

#### WD — 取消叫醒（Wake-up Delete）

PMS 通知系統取消已預約的叫醒排程。

```
PMS → 系統：\x02WD|RN<房號>|TI<時間>|DT<日期>\x03
```

| 欄位 | 說明 | 格式 | 必填 |
|------|------|------|------|
| `RN` | 房間號碼 | 數字字串 | ✅ |
| `TI` | 原預約時間 | `HHMM` | ✅ |
| `DT` | 原預約日期 | `YYMMDD` | ❌ |

**系統 → PMS（回應）**
```
\x02WC|RN<房號>|ST<狀態>\x03
```

取消時同步刪除 DB 記錄並取消所有待執行的重試排程。

---

### 3.4 完整對話範例

```
PMS  → 系統：\x02LS\x03
系統 → PMS ：\x02LS|DA260326|TI080000\x03

PMS  → 系統：\x02LA\x03
系統 → PMS ：\x02LA\x03

PMS  → 系統：\x02WR|RN101|TI0730|DT260326|RI5|MR3\x03
系統 → PMS ：\x02WC|RN101|ST1\x03
（07:30 撥打 101 房，未接）
（等待 5 分鐘）
（07:35 重試，接聽 → 結束）

PMS  → 系統：\x02WD|RN202|TI0800|DT260326\x03
系統 → PMS ：\x02WC|RN202|ST1\x03
```

### 3.5 已知缺口（待補）

| 項目 | 說明 |
|------|------|
| `WS`（Wake-up Status）| 叫醒完成後主動回送結果給 PMS（部分 PMS 如 Protel 需要）|

---

## 四、Nortel PMS 協定（骨架）

> ⚠️ 尚未取得完整規格文件，以下為已知資訊，實作標記 TODO。

### 4.1 連線資訊

- **協定**：TCP 長連線
- **訊息格式**：純文字，每行一個指令（推測 `\r\n` 結尾，待確認）
- **無特殊封包 byte**

### 4.2 已知指令格式（來自 NewRock PMSI 文件）

| 功能 | 格式 | 範例 |
|------|------|------|
| 叫醒預約 | `SE ST <dn> TI<time>ON` | `SE ST 101 TI07:30ON` |
| 叫醒取消 | `SE ST <dn> TI<time>OF` | `SE ST 101 TI07:30OF` |
| 勿打擾開啟 | `SE ST <dn> DN ON` | `SE ST 101 DN ON` |
| 勿打擾關閉 | `SE ST <dn> DN OF` | `SE ST 101 DN OF` |
| Check-in | `SE ET <dn> CH IN <name> <E/F>` | `SE ET 101 CH IN WM E4` |
| Check-out | `SE ET <dn> CH OF` | `SE ET 101 CH OF` |

### 4.3 待確認項目（需規格文件）

- [ ] 訊息結尾符號（`\r\n` / `\n` / 其他）
- [ ] ACK 回應格式（目前預設回 `ACK`）
- [ ] 握手/心跳機制是否存在
- [ ] 欄位精確解析規則

---

## 五、環境變數

| 變數 | 說明 | 必填 | 預設值 |
|------|------|------|--------|
| `PMS_PROTOCOL` | 協定選擇：`FIAS` 或 `NortelPMS` | ✅ | — |
| `PMS_PORT` | PMS TCP 監聽 Port | ❌ | `4021` |
| `FIAS_EXTENSION_PREFIX` | 房號轉分機前綴（如 `9` 則 `101` → `9101`）| ❌ | `""` |
| `OM_CALL_FROM_EXTENSION` | 主叫分機號碼 | ✅ | — |

---

## 六、使用 PacketSender 測試

### FIAS 測試

1. Protocol：`TCP`，Host：`127.0.0.1`，Port：`4021`
2. 模式選 `ASCII`，輸入訊息（`\x02` / `\x03` 為特殊 byte）：

```
握手：  \x02LS\x03
心跳：  \x02LA\x03
叫醒：  \x02WR|RN101|TI0730|DT260326|RI5|MR3\x03
取消：  \x02WD|RN101|TI0730|DT260326\x03
```

### Nortel PMS 測試（骨架）

1. 設定相同，純文字直接送：

```
SE ST 101 TI07:30ON
SE ST 101 TI07:30OF
```

目前骨架只 log 收到的訊息並回 `ACK`，不會真的建排程（TODO 未填）。

---

## 七、新增協定（擴充方式）

未來要支援新協定（如 Mitel SX-2000），只需：

1. 在 `util/` 新增 TCP server 解析實作（參考 `fias.ts` 或 `nortelPms.ts`）
2. 在 `components/` 新增對應 handler（參考 `fiasHandler.ts`）
3. 在 `services/pmsServer.ts` 的 `switch` 加入新 case
4. 在 `.env.example` 新增選項說明

**不需要修改 app.ts 或其他檔案。**

---

## 八、與主管討論事項

### 核心問題：目標客戶用哪家 PMS？

| 若客戶 PMS 是... | 需要的協定 | 目前狀態 |
|----------------|-----------|---------|
| Opera / Protel / Fidelio | FIAS | ✅ 已完成 |
| ICS&S / Foxhis / Pegasus / ShenOu | Nortel PMS | 🚧 需規格文件 |
| Mitel SX-2000 | Mitel Protocol | ❌ 需規格文件 |

### 建議詢問主管的三個問題

1. **客戶規模與地區**：國際連鎖為主還是台灣/亞洲在地飯店？
2. **是否有已知潛在客戶**：他們用的是哪家 PMS 系統？
3. **WS 回報是否必要**：叫醒完成後 PMS 介面需要顯示結果嗎？
