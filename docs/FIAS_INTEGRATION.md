# FIAS Integration

本文件說明 PMS（飯店管理系統）透過 FIAS 協定與本系統互動的訊息格式與流程。

---

## 連線資訊

- **協定**：TCP（FIAS）
- **Port**：`FIAS_PORT`（預設 `4021`，可透過 `.env` 設定）
- **編碼**：ASCII
- **訊息格式**：每則訊息以 `STX`（`\x02`）開頭、`ETX`（`\x03`）結尾

```
\x02TYPE|FIELD1VALUE1|FIELD2VALUE2\x03
```

---

## 欄位格式規則

- 每個欄位由 **2 字元 Key** + **Value** 組成，無分隔符
- 欄位之間以 `|` 分隔
- 第一個欄位為**訊息類型**（2 字元）

```
WR|RN101|TI0730|DT260312|RI5|MR3
^   ^         ^         ^      ^
類型 RN=101  TI=0730  DT=260312  RI=5  MR=3
```

---

## 訊息類型

### LS — 連線握手（Link Start）

PMS 連線後發送，本系統回應確認。

**PMS → 系統**
```
\x02LS\x03
```

**系統 → PMS**
```
\x02LS|DA260226|TI120000\x03
```

| 欄位 | 說明 |
|------|------|
| `DA` | 日期 YYMMDD |
| `TI` | 時間 HHMMSS |

---

### LA — 心跳（Link Alive）

PMS 定期發送，本系統直接回應 `LA`。

**PMS → 系統**
```
\x02LA\x03
```

**系統 → PMS**
```
\x02LA\x03
```

---

### WR — 叫醒預約（Wake-up Request）

PMS 通知系統在指定時間撥打指定房間。

**PMS → 系統**
```
\x02WR|RN<房間號碼>|TI<時間>|DT<日期>|RI<重試間隔>|MR<最大重試>\x03
```

| 欄位 | 說明 | 格式 | 必填 |
|------|------|------|------|
| `RN` | 房間號碼 | 數字字串，如 `101` | ✅ |
| `TI` | 叫醒時間 | `HHMM`，如 `0730` | ✅ |
| `DT` | 叫醒日期 | `YYMMDD`，如 `260312` | ❌（省略則當天，已過則明天）|
| `RI` | 未接時重試間隔（分鐘）| 數字字串，如 `5` | ✅ |
| `MR` | 最大重試次數 | 數字字串，如 `3` | ✅ |

**範例：2026/03/12 07:30 叫醒 101 房，每 5 分鐘重試最多 3 次**
```
\x02WR|RN101|TI0730|DT260312|RI5|MR3\x03
```

**系統 → PMS（回應）**
```
\x02WC|RN<房間號碼>|ST<狀態>\x03
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

### WC — 取消叫醒（Wakeup Clear）

PMS 通知系統取消指定房間的叫醒排程。`WC` 為 Oracle Hospitality IFC8 FIAS Interface Specs
定義的正式代碼；先前文件記錄的 `WD` 找不到任何官方規格根據，已移除。

**PMS → 系統**
```
\x02WC|RN<房間號碼>|TI<時間>|DT<日期>\x03
```

| 欄位 | 說明 | 格式 | 必填 |
|------|------|------|------|
| `RN` | 房間號碼 | 數字字串，如 `101` | ✅ |
| `TI` | 原預約時間 | `HHMM` | ✅ |
| `DT` | 原預約日期（規格正式欄位是 `DA`，兩者皆接受） | `YYMMDD` | ❌ |

**範例：取消 101 房 07:30 的叫醒**
```
\x02WC|RN101|TI0730|DT260312\x03
```

**系統 → PMS（回應）**
```
\x02WC|RN<房間號碼>|ST<狀態>\x03
```

取消時會同時刪除 DB 記錄並取消所有待執行的重試排程。

---

### GI / GO — 客人入住 / 退房（Guest In / Guest Out）

> 僅於 `TELEPHONE_EQUIPMENT=FreeSwitch` 時生效：收到後透過 FusionPBX 的 FIAS Middleware
> （`FREESWITCH_PMS_API_URL`，見《FusionPBX / FreeSWITCH PMS-FIAS 整合說明書》）更新房間分機的
> 通話權限與顯示名稱。其他設備收到時僅記錄後略過。

**PMS → 系統（入住）**
```
\x02GI|RN<房間號碼>|GN<房客姓名>|CS<權限等級>\x03
```

**PMS → 系統（退房）**
```
\x02GO|RN<房間號碼>\x03
```

| 欄位 | 說明 | 必填 |
|------|------|------|
| `RN` | 房間號碼（套用 `FIAS_EXTENSION_PREFIX` 後轉為分機號） | ✅（缺漏則忽略該訊息）|
| `GN` | 房客姓名（僅 GI；缺漏時分機顯示名稱預設為 `Room <分機>`）| ❌ |
| `CS` | Class of Service，僅 GI（見下方對照表；缺漏或值不在 0-3 時預設 `CS2`）| ❌ |

**CS（Class of Service）→ 我方 `toll_allow` 對照**（Oracle Hospitality IFC8 FIAS Interface Specs）：

| FIAS CS | 意義 | 對應 `toll_allow` |
|---------|------|-------------------|
| 0 | Barred/hotel internal only | `CS0` |
| 1 | Local | `CS1` |
| 2 | National | `CS2` |
| 3 | No restrictions | `CS3` |

效果：
- **GI**：分機 `toll_allow` 依 `CS` 欄位設定（缺漏預設 `CS2`：市內＋國內＋行動），顯示名稱改為房客姓名
- **GO**：分機 `toll_allow` 收回為 `CS0`（僅內線/緊急/免付費），顯示名稱還原為 `Room <分機>`；規格上 GO 本來就不帶 `CS`/`GN`（Oracle 規格明訂退房記錄不傳送房客身分資訊）

GI/GO 為 PMS 單向通知，本系統不回覆業務層 ACK；Middleware 呼叫失敗僅記錄 log，不中斷 FIAS 連線。

### GC — 住客資料異動 / 換房（Guest Change / Room Move）

```
\x02GC|RN<新房號>|RO<舊房號>|GN<房客姓名>|CS<權限等級>\x03
```

| 欄位 | 說明 | 必填 |
|------|------|------|
| `RN` | 目的房號（換房後的新房） | ✅ |
| `RO` | 來源房號（換房前的舊房）。**有此欄位才視為換房**，缺漏時視為單純資料異動（例如僅改房客姓名），暫不處理 | 換房時必填 |
| `GN` | 新房房客姓名 | ❌ |
| `CS` | Class of Service，對照表同 GI | ❌ |

換房效果：舊房（`RO`）依 GO 邏輯退房 → 新房（`RN`）依 GI 邏輯入住，依序執行；舊房退房失敗不阻擋新房入住（客人已實際搬過去，不應因此打不了電話）。

---

### RE — 房務狀態通知（Room Equipment / Room Status）

> 依 Oracle Hospitality FIAS Interface Specs（IFC8, 2.20.23）Appendix B 訂正；`RE`/`RS` 為官方定義的正式記錄類型，非我方自訂。

房務系統透過 REST API（`POST /api/v1/lakeshore/room/status`，見《房務狀態串接開發規格書》）推送房況異動，
本系統驗證後**主動**轉發給 PMS。目前為 fire-and-forget，不等待 PMS 回應——
FIAS 規格中的 `<ACK>/<NAK>` 僅為序列傳輸層級的位元組完整性確認，並非「PMS 是否成功處理」的業務回應，
標準 FIAS 本身不提供 RE 記錄的業務層級 ack。

**系統 → PMS**
```
\x02RE|RN<房間號碼>|RS<FIAS房務狀態>\x03
```

| 欄位 | 說明 | 格式 |
|------|------|------|
| `RN` | 房間號碼 | 數字字串，如 `101` |
| `RS` | FIAS 標準 Room Maid Status（見下表） | `N, 2` |

**FIAS RS 標準代碼（Appendix B）**

| 代碼 | 意義 |
|------|------|
| 1 | Dirty/Vacant |
| 2 | Dirty/Occupied |
| 3 | Clean/Vacant |
| 4 | Clean/Occupied |
| 5 | Inspected/Vacant |
| 6 | Inspected/Occupied |

> ⚠️ 規格明確指出：**無法透過外部系統把房間狀態設為 Out-of-Order/Out-of-Service**，此狀態只能在 PMS 本身操作。

**煙波 roomstatus 直接當 FIAS RS 送出，不做轉換**

原本嘗試依 Oracle 官方 Appendix B 的 1-6 代碼做轉換對照，但實測發現跟這台 Protel
實際設定不符（例如送 `RS5` 結果 Protel 顯示「清潔中」而非官方定義的「已檢查」）。
規格本身也註明「Further values may be possible depending on the Hotels PMS setup」，
代碼意義由各 PMS 安裝自行決定，與其猜測對照表，改為煙波的 `roomstatus` 是多少就直接送多少。

**範例：101 房狀態變更為煙波 roomstatus=1**
```
\x02RE|RN101|RS1\x03
```

### RE（反向）— DND 免打擾

> `RE` 是雙向記錄類型：上面的 `RS` 是我方主動送給 PMS；這裡的 `DN` 則是 **PMS 主動送給我方**，兩者用途完全獨立，互不影響。

僅於 `TELEPHONE_EQUIPMENT=FreeSwitch` 時生效：收到後透過 FIAS Middleware 的 `/pms/extension/update`（`do_not_disturb` 欄位）更新房間分機的 DND 狀態。本系統純轉發，DND 開啟後的實際擋話行為由 FreeSwitch/FusionPBX middleware 負責。

**PMS → 系統**
```
\x02RE|RN<房間號碼>|DN<Y/N>\x03
```

| 欄位 | 說明 | 必填 |
|------|------|------|
| `RN` | 房間號碼（套用 `FIAS_EXTENSION_PREFIX` 後轉為分機號） | ✅（缺漏則忽略該訊息）|
| `DN` | Do-Not-Disturb，`Y`=開啟 `N`=關閉 | ❌（缺漏則忽略，目前只處理 DND，不處理 RE 的其他欄位）|

> 規格上 `CS`（Class of Service）也可能透過 `RE` 單獨送達（不經過 GI/GC），目前尚未確認 Protel 是否採此模式，暫不處理。

---

## 環境變數

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `FIAS_PORT` | TCP 監聽 Port | `4021` |
| `FIAS_EXTENSION_PREFIX` | 房間號碼轉分機的前綴（如設 `9` 則 `101` → `9101`）| `""` |
| `OM_CALL_FROM_EXTENSION` | 主叫分機（機器人） | `9038` |
| `LAKESHORE_IP_WHITELIST` | `POST /api/v1/lakeshore/room/status` 允許呼叫的來源 IP，逗號分隔；未設定則不檢核 | `""` |

---

## 完整對話範例

```
PMS  → 系統：\x02LS\x03
系統 → PMS ：\x02LS|DA260312|TI080000\x03

PMS  → 系統：\x02LA\x03
系統 → PMS ：\x02LA\x03

PMS  → 系統：\x02WR|RN101|TI0730|DT260312|RI5|MR3\x03
系統 → PMS ：\x02WC|RN101|ST1\x03

（07:30 到了，撥打 101 房，未接）
（等待 5 分鐘後重試...）
（07:40 重試，101 房接聽 → 已接聽）

PMS  → 系統：\x02WC|RN202|TI0800|DT260312\x03
系統 → PMS ：\x02WC|RN202|ST1\x03
```
