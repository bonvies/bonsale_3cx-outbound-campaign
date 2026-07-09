# Call Schedule：同分機重疊來電導致通話結果遺失（已修復）

**狀態：已修復**（`callMonitorCore.ts`，改用佇列追蹤同分機的多通電話）
**發現方式**：煙波（Lakeshore）FIAS 實測，客戶短時間內對同一房間連續設定多次晨喚
**證據來源**：`260709-3_bonsale_3cx-outbound-campaign_backend_logs.txt`（本文引用的所有 log 行皆出自此檔）

---

## 一、問題現象

客戶對房間 **0330** 連續測試了 5 次晨喚（`WR`），其中兩筆的目標叫醒時間**同樣落在 10:07**：

| WR 收到時間 | 目標叫醒時間 (TI) | Schedule ID | 最終結果 |
|---|---|---|---|
| 09:58:18 | 10:02 | `40bc7eca...` | ✅ 接聽 → `WA...ASOK` |
| 10:05:13 | 10:07 | `2463d212...` | ✅ 未接聽 → `WA...ASNR` |
| 10:05:23 | **10:07（撞同一分鐘）** | `c324923c...` | ❌ **結果消失，從未回報 `WA`** |
| 10:05:45 | 10:08 | `b2aa8075...` | ✅ 未接聽 → `WA...ASNR` |
| 10:06:13 | 10:10 | `238d8115...` | ✅ 未接聽 → `WA...ASNR` |

`c324923c` 這通電話**確實有撥出去**（房間電話確實響過），但：
- SQLite `call_schedules` 表裡這筆記錄永遠停在 `callStatus = CALLING`，沒有進一步更新
- 系統**從未**送出對應的 `WA` 記錄回報給 PMS（Protel）
- 除了 10:07:00 那一行「已登記監控」之外，log 裡再也沒有任何一行提到 `c324923c`

---

## 二、架構背景：一通晨喚電話會經過哪些元件

```
PMS(Protel)          後端                            FreeSwitch py-dialer      PMS(Protel)
  │  WR                  │                                    │                      │
  ├───────────────────▶ fiasHandler.ts (case 'WR')             │                      │
  │                      └─▶ createCallSchedule()              │                      │
  │                           └─▶ scheduleCallJob()             │                      │
  │                                （node-schedule 排一個未來時間點的 job）             │
  │  ◀── WC|ST1 ─────────┤                                    │                      │
  │                      │        （時間到，job 觸發）           │                      │
  │                      ├─ phoneApiService.makeCall() ──────▶ HTTP 撥號（回 request_id）│
  │                      ├─ registerCall() → 寫進 pendingCalls（開始追蹤這通電話）        │
  │                      │                          （電話響、掛斷，py-dialer 判定結果） │
  │                      │  ◀── POST /freeswitch-webhook（CDR，只帶 extension）─────────┤
  │                      ├─ handleCallResult() → handleAnswer()/handleBye()             │
  │                      │      └─ 從 pendingCalls 撈出這通電話的紀錄、更新 DB            │
  │  ◀── WA|AS?? ────────┤      └─ notifyCallResult() → FiasWakeupResultHandler          │
```

關鍵落差：**PMS → 我方**（`WR`）帶著完整資訊（房間、時間），但 **py-dialer → 我方**（CDR callback，`FreeSwitchCallMonitorService.ts` 的 `handleCallResult()`）**只帶分機號碼，不帶「這是哪一次排程觸發的電話」**。這個資訊落差就是 bug 的根源。

### 修復前的追蹤資料結構

```ts
// callMonitorCore.ts（修復前）
const pendingCalls = new Map<string, PendingCall>();  // key = 分機號碼，value = 單一物件
```

`Map` 用**分機號碼**當 key，且一個 key **只能存一筆**。`registerCall()` 對同一個分機再呼叫一次，會直接覆蓋掉舊值：

```ts
pendingCalls.set('0330', callA);  // { '0330' → callA }
pendingCalls.set('0330', callB);  // { '0330' → callB }，callA 已經找不到了
pendingCalls.get('0330');         // 永遠只會拿到「最後一次 registerCall 存進去的那筆」
```

---

## 三、詳細時間軸（兩筆排程如何互相覆蓋）

| 時刻 | `2463d212`（10:05:13 收到，目標 10:07） | `c324923c`（10:05:23 收到，目標同樣 10:07） | 此刻 `pendingCalls.get('0330')` |
|---|---|---|---|
| 10:05:13 | `WR` 收到 → 建立排程，`node-schedule` 排 10:07:00 的 job | — | （空） |
| 10:05:23 | — | `WR` 收到 → 建立排程，`node-schedule` **也**排 10:07:00 的 job | （空） |
| 10:07:00.001 | — | `node-schedule` **先**觸發此 job（純粹是內部排序的巧合，跟收到 `WR` 的先後順序無關）→ `makeCall()` 撥出（`request_id=47a90c31`）→ `registerCall()` | `{ scheduleId: c324923c }` |
| 10:07:00.009 | `node-schedule` 觸發此 job（晚 8ms）→ `makeCall()` 撥出（`request_id=381da98d`）→ `registerCall()` **覆蓋** | — | `{ scheduleId: 2463d212 }`（`c324923c` 的紀錄消失） |
| ~10:07:0x | 電話響，房客沒接 | 電話響，房客沒接 | `{ scheduleId: 2463d212 }` |
| 10:07:31 | py-dialer 判定 no_answer，callback `request_id=381da98d` → `handleBye('0330')` → `pendingCalls.get('0330')` 拿到 `2463d212`（**剛好是對的，因為它是最後蓋進去的那筆**）→ ✅ `NO_ANSWER`，送出 `WA\|RN0330\|...\|TI100700\|ASNR\|` | — | `handleBye` 執行完 → `pendingCalls.delete('0330')`（空） |
| ~10:07:3x | — | py-dialer 判定 no_answer，callback `request_id=47a90c31` → `handleBye('0330')` → `pendingCalls.get('0330')` → **`undefined`**（已被上一步刪除）→ `if (!call) return;` **什麼都沒做** | （空） |
| 之後 | — | ❌ DB 停在 `callStatus=CALLING`，**從未送出 `WA`** | — |

### 對應的原始 log

```
[2026-07-09 10:05:13] [CallScheduleService] Scheduling job 2463d212... at 2026-07-09T02:07:00.000Z
[2026-07-09 10:05:23] [CallScheduleService] Scheduling job c324923c... at 2026-07-09T02:07:00.000Z

[2026-07-09 10:07:00] [CallScheduleService] Executing job c324923c... at 2026-07-09T02:07:00.001Z
[2026-07-09 10:07:00] [CallScheduleService] Executing job 2463d212... at 2026-07-09T02:07:00.009Z
[2026-07-09 10:07:00] [freeSwitchApi] makeMorningCall( → 0330) HTTP 202 request_id=47a90c31...  # c324923c 的電話
[2026-07-09 10:07:00] ✍️ [CallMonitor] 已登記監控 scheduleId=c324923c... ext=0330 retry=0/0
[2026-07-09 10:07:00] [freeSwitchApi] makeMorningCall( → 0330) HTTP 202 request_id=381da98d...  # 2463d212 的電話
[2026-07-09 10:07:00] ✍️ [CallMonitor] 已登記監控 scheduleId=2463d212... ext=0330 retry=0/0     # 覆蓋掉上一筆

[2026-07-09 10:07:31] [FreeSwitchMonitor] 📋 通話結果 request_id=381da98d... result=no_answer
[2026-07-09 10:07:31] [CallMonitor] ☎️ BYE (未接聽) ext=0330 scheduleId=2463d212... retryCount=0/0
[2026-07-09 10:07:31] [CallMonitor] 已達最大重試次數 (0)，標記為未接聽
[2026-07-09 10:07:31] [CallMonitor] 2463d212... → status: NO_ANSWER
[2026-07-09 10:07:31] [FiasClient] 發送訊息: WA|RN0330|DA260709|TI100700|ASNR|

# c324923c 的 request_id=47a90c31 稍後也回了 result=no_answer，
# 但之後完全沒有任何 CallMonitor / WA 的 log —— 結果被吃掉了
```

---

## 四、為什麼「剛好」是 `2463d212` 活下來？

純粹是**毫秒級時序的巧合**，跟哪個排程「先被 PMS 送出」或「先撥出電話」都沒有邏輯關係：

- `c324923c` 雖然是**後**送出的 `WR`（10:05:23，晚 `2463d212` 10 秒），但它的 job 卻**先**被 `node-schedule` 觸發（10:07:00.001 vs .009）
- 決定誰活下來的，不是撥號順序、不是 CDR 回來的順序，而是「**誰最後呼叫了 `registerCall()`**」——因為 `Map.set()` 後寫入的會蓋掉先寫入的
- 這次恰好 `2463d212` 最後 `registerCall`，所以它「僥倖」被追蹤到；順序若反過來，被吃掉的就會是 `2463d212`

**結論：這是一個不可預測、不可穩定重現的競態條件（race condition）**——只有「同一分機、同一時刻有兩通以上電話同時在飛行中」才會觸發。

### 為什麼同批測試裡 10:08、10:10 那兩通沒事？

因為 `b2aa8075`（目標 10:08）和 `238d8115`（目標 10:10）的目標時間點彼此不同，每個時間點分機 0330 都**只有一通**電話在飛行中，`pendingCalls.get('0330')` 永遠只有一筆、永遠對得上，配對邏輯自然正常。

---

## 五、影響範圍

- **不是撥號失敗**——電話確實撥出去、確實響過
- **是「結果回報」被靜默吃掉**——DB 卡在 `CALLING`、PMS 永遠收不到那通電話的最終 `WA`
- 觸發條件：同一分機在前一通電話結果還沒處理完前，又有第二通電話進入監控。可能發生在：
  - 使用者（或客戶測試時）短時間內對同一房間連續設定重疊時間的晨喚
  - 重試機制的重試時間點，剛好撞上同分機的下一筆新排程

---

## 六、修復方式

把 `pendingCalls` 的 value 從「單一物件」改成「佇列（陣列）」，用 FIFO（先登記先處理）比對事件，而不是用同一個 key 互相覆蓋：

```ts
// callMonitorCore.ts（修復後）
const pendingCalls = new Map<string, PendingCall[]>();

function peekCall(ext: string): PendingCall | undefined {
  return pendingCalls.get(ext)?.[0];
}

function dequeueCall(ext: string): PendingCall | undefined {
  const queue = pendingCalls.get(ext);
  if (!queue || queue.length === 0) return undefined;
  const call = queue.shift();
  if (queue.length === 0) pendingCalls.delete(ext);
  return call;
}

function enqueueCall(call: PendingCall): void {
  const queue = pendingCalls.get(call.extension) ?? [];
  queue.push(call);
  pendingCalls.set(call.extension, queue);
}
```

對應調整：

- **`registerCall()`** → 改用 `enqueueCall`：新電話推進佇列尾端，不再覆蓋前一筆
- **`handleRing()`** → 改用 `peekCall`：只讀佇列最前面那通做狀態更新，不移除
- **`handleAnswer()` / `handleBye()`** → 改用 `dequeueCall`：取出佇列**最前面（最早登記）**那通處理完才移除，不會撞到還在飛行中的其他通
- 新增 **`clearPendingCall()`**：給 `NewRockCallMonitorService.ts` 「我方掛斷、通話正常結束」情境使用，取代原本直接對 Map 做 `.delete()` 的寫法（NewRock 之前是拿到 `getPendingCalls()` 的 Map 直接操作，改資料結構後這裡也要走公開 API，不能再假設內部是單一物件）

以同一組時間軸重跑：10:07:00.001 `c324923c` 進佇列 `['c324923c']`；10:07:00.009 `2463d212` 推進佇列尾端（不覆蓋）→ `['c324923c', '2463d212']`。10:07:31 第一個 CDR 回來，`dequeueCall` 取出佇列最前面的 `c324923c`、正確配對、送出它的 `WA`，佇列剩 `['2463d212']`；稍後第二個 CDR 回來，再取出 `2463d212`、送出它的 `WA`。兩通都不會再互相覆蓋或消失。

此修法的前提假設：**同一分機的多通電話，其 RING/ANSWER/BYE 事件會依登記順序抵達**——這在真實電話情境下合理（同分機同一時刻只會有一通真正在響/接聽），且與現有三種設備（NewRock、Yeastar、FreeSwitch）的事件驅動模型相容。

---

## 七、相關檔案

| 檔案 | 角色 |
|---|---|
| `apps/backend/src/features/call-schedule/components/fiasHandler.ts` | 收 `WR`，建立排程 |
| `apps/backend/src/features/call-schedule/services/callService/callScheduleService.ts` | `scheduleCallJob`：`node-schedule` 排程、觸發撥號 |
| `apps/backend/src/features/call-schedule/services/callService/monitor/callMonitorCore.ts` | `pendingCalls` 追蹤邏輯（本次修復對象） |
| `apps/backend/src/features/call-schedule/services/callService/monitor/device/FreeSwitchCallMonitorService.ts` | CDR webhook 入口，只帶 `extension` 分流給 `handleAnswer`/`handleBye` |
| `apps/backend/src/features/call-schedule/services/callService/monitor/device/NewRockCallMonitorService.ts` | 改用 `clearPendingCall()` 取代直接操作 Map |
| `apps/backend/src/features/call-schedule/components/fiasWakeupResultHandler.ts` | 送出最終 `WA` 記錄回報 PMS |
| `docs/FIAS_LAKESHORE_TEST_LOG.md` | 煙波實測原始封包記錄 |
