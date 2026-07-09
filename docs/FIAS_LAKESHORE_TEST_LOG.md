# FIAS 煙波（Lakeshore）實測記錄

本文件記錄跟煙波飯店 Protel PMS 實際對接測試時，客戶端（Protel）真正送出的原始封包內容，
作為之後開發/除錯時的參考——**規格文件（`FIAS_INTEGRATION.md`）描述的是官方標準，
這份文件記錄的是「這台 Protel 實際上會送什麼」，兩者不一定完全一致**。

- PMS：Protel（`192.168.12.22:5006`），我方以 TCP client 身份連線過去（`FIAS_MODE=client`）
- 測試房號：`0323`、`0527`、`0330`

## 測試進度

| 項目 | 狀態 | 備註 |
|------|------|------|
| 1. Check in | ✅ | |
| 2. Morning call | ✅ | 完整迴圈已驗證；另發現並修復 `WC` 誤判為取消請求的 bug，**待重新實測確認** |
| 3. DND（勿擾） | ✅ | |
| 4. Posting calls | ⬜ 未測 | |
| 5. Room Move | ✅ | 實際走 GO+GI，不是 GC |
| 6. Room Status | ✅ | 測 `/api/v1/lakeshore/room/status` 成功 |
| 7. Check out | ⬜ 未測 | |

---

## 1. Check-in（GI）

```
[2026-06-17 18:01:53] 訊息內容: {
  type: 'GI',
  fields: {
    HS: '10', GS: 'N', RN: '0323', 'G#': '3891791',
    GN: 'f8,h)&h(\x02f\b?',
    BD: '19000101', CU: 'To Be Advised', CY: '', EM: '', FX: '',
    MK: '09 System Use', MP: '', PN: '', PW: '', RR: '', ST: '',
    GV: '', ZP: '', NR: '', GF: '', GT: '', PT: 'BAR00R', PR: '',
    GG: '', GR: '', GM: '1', 'G+': '1862451',
    CS: '0', GL: 'GE', MR: 'MU', NP: 'N', TV: 'TU', VR: 'VN', SM: '00',
    GA: '260630', GD: '260701', KO: ''
  }
}
```

**觀察重點**
- `HS: '10'`：**非官方欄位**，查過 Oracle FIAS 全文找不到定義，`GC`（見下方換房測試）也有一樣的值 `10`，推測是固定的工作站/系統識別碼，非業務資料，目前忽略不影響處理
- `CS: '0'` → 我方 `toll_allow` 對照為 `CS0`（僅內線/緊急/免付費，不含市內），check-in 時房客電話權限預設偏嚴格
- `GA`/`GD`（抵/離日期）、`PT`（房價代碼）、`MK`（市場代碼）等大量欄位都有值，證實 `fiasLinkProtocol.ts` 的 `LINK_RECORDS` 對 `GI` 宣告全部欄位是對的（沒宣告會收不到這些）
- ⚠️ `GN`（房客姓名）內容是 `'f8,h)&h(\x02f\b?'`，明顯是亂碼，裡面還混了一個 `\x02`（STX 控制字元）——**懷疑是編碼問題**（例如 Protel 用非 UTF-8 編碼送出中文姓名，但我方 `FIAS_ENCODING` 設定沒對上），需要之後拿真實中文姓名的房客再測一次確認，不要照這筆資料直接判斷姓名處理沒問題

---

## 2. Morning call（WR）

```
[2026-06-17 18:01:53] 訊息內容: {
  type: 'WR',
  fields: { HS: '10', RN: '0323', DA: '260701', TI: '083000', '': '' }
}
```

**觀察重點**
- `DA`（不是 `DT`）：**證實官方欄位代碼 `DA` 才是這台 PMS 真正在用的**，`fiasHandler.ts` 的 `DT ?? DA` fallback 有接住
- `TI: '083000'`：6 碼 `HHMMSS`，我方只解析前 4 碼（`HHMM`），秒數被忽略，不影響結果
- 沒有 `RI`/`MR` 欄位：證實這兩個是我方自創的假設欄位，PMS 不會送，套用預設值即可
- 同樣帶有 `HS: '10'`

### 2026-07-09 完整迴圈驗證（接聽 + 未接聽兩種結果都測過）

這次不只收到 `WR`，連後續撥打、接聽判定、回報 `WA` 給 PMS 的完整流程都一起驗證了。

**案例 A：準時撥打、房客接聽**

```
[2026-07-09 11:55:00] [FiasClient] 收到原始訊息: WR|RN0330|DA260709|DT|TI115700|RI|MR|
[2026-07-09 11:55:00] [CallScheduleService] Scheduling job 531c4cd1... at 2026-07-09T03:57:00.000Z
[2026-07-09 11:55:00] [FIAS] WR 排程：房間=0330 分機=0330 時間=...T03:57:00.000Z retryInterval=1min maxRetries=0 id=531c4cd1...
[2026-07-09 11:55:00] [FiasClient] 發送訊息: WC|RN0330|ST1

[2026-07-09 11:57:00] [CallScheduleService] Executing job 531c4cd1... at ...T03:57:00.003Z
[2026-07-09 11:57:01] [freeSwitchApi] makeMorningCall( → 0330) HTTP 202 request_id=adbd5323...
[2026-07-09 11:57:01] ✍️ [CallMonitor] 已登記監控 scheduleId=531c4cd1... ext=0330 retry=0/0 retryIntervalMs=60000
[2026-07-09 11:57:11] [CallMonitor] 📞 ANSWER ext=0330 scheduleId=531c4cd1...
[2026-07-09 11:57:11] [CallMonitor] 531c4cd1... → status: ANSWERED
[2026-07-09 11:57:11] [FiasClient] 發送訊息: WA|RN0330|DA260709|TI115700|ASOK|
```

**案例 B：準時撥打、房客未接聽（1 秒後緊接著又收到第二筆 `WR`，目標時間 12:00）**

```
[2026-07-09 11:55:01] [FiasClient] 收到原始訊息: WR|RN0330|DA260709|DT|TI120000|RI|MR|
[2026-07-09 11:55:01] [CallScheduleService] Scheduling job 56739012... at 2026-07-09T04:00:00.000Z
[2026-07-09 11:55:01] [FIAS] WR 排程：... maxRetries=0 id=56739012...
[2026-07-09 11:55:01] [FiasClient] 發送訊息: WC|RN0330|ST1

[2026-07-09 12:00:00] [CallScheduleService] Executing job 56739012... at ...T04:00:00.015Z
[2026-07-09 12:00:00] [freeSwitchApi] makeMorningCall( → 0330) HTTP 202 request_id=013bac29...
[2026-07-09 12:00:00] ✍️ [CallMonitor] 已登記監控 scheduleId=56739012... ext=0330 retry=0/0 retryIntervalMs=60000
[2026-07-09 12:00:13] [CallMonitor] ☎️ BYE (未接聽) ext=0330 scheduleId=56739012... retryCount=0/0
[2026-07-09 12:00:13] [CallMonitor] 已達最大重試次數 (0)，標記為未接聽
[2026-07-09 12:00:13] [CallMonitor] 56739012... → status: NO_ANSWER
[2026-07-09 12:00:13] [FiasClient] 發送訊息: WA|RN0330|DA260709|TI120000|ASNR|
```

**觀察重點**
- 兩種結果（接聽 `ASOK`／未接聽 `ASNR`）都正確送出對應的 `WA`，完整迴圈（`WR`→排程→準時撥打→判定結果→`WA` 回報）跑通
- `RI|MR|`（欄位存在但空值）沒有造成問題：`maxRetries=0` 正確套用（`fiasHandler.ts` 空字串 fallback 修復後的效果），未接聽時直接標記 `NO_ANSWER`、不會多重試一次
- 兩筆 `WR` 相隔僅 1 秒、且都是房間 0330，但目標時間不同（11:57 / 12:00），沒有互相干擾——`pendingCalls` 佇列化修復（見 `docs/CALL_SCHEDULE_PENDING_CALLS_RACE_CONDITION.md`）在此次測試未被觸發（因為兩通電話的執行時間點不重疊），但用來驗證正常情況下多筆排程互不影響
- ⚠️ log 裡看到的 `[FiasClient] 發送訊息: WC|RN0330|ST1`（收到 `WR` 後馬上回送）**後來證實是錯誤設計、已移除**，詳見下方「2026-07-09 發現：`WC` 誤判為取消請求」

### 2026-07-09 發現：`WC` 誤判為取消請求（已修復）

跟客戶（Verena）核對 Protel 自己內部的 log（`automate`/`dispatcher`/`database` 這幾個是 Protel 內部服務名稱，不是我方系統）時發現：

```
[7] 2026.07.09 10:35:11.271 database: ref: 857 <Flags><RM>0330</RM><WN>362287</WN><CP>1</CP><TR>0</TR><SC>1</SC><NT>Deleted from room 0330</NT></Flags>
[6] 2026.07.09 10:35:11.271 automate: 20.1 change state to 'busy' processing ref: 857
[7] 2026.07.09 10:35:11.271 dispatcher: outgoing packet <WakeupChange><WakeupNo>362287</WakeupNo><Completed>1</Completed><Note>Deleted from room 0330</Note><Tries>0</Tries><Success>1</Success></WakeupChange> for automate: 20.1
```

跟另一筆正常案例（另一廠商系統，房間 1019）對比：

```
2026.07.09 04:03:22.483 automate: 1.1 received packet 'Wakeup Performed' |RN1019|DA260709|TI040000|ASOK|
[6] 2026.07.09 04:03:22.483 database: ref: 11603872 stored 'guest wakeup change' resno: 3873846 client: 2 automate: 20.1
[7] 2026.07.09 04:03:22.483 database: ref: 11603872 <Flags><RM>1019</RM><WN>362245</WN><CP>1</CP><TR>1</TR><SC>1</SC><NT>Performed successful</NT></Flags>
```

**關鍵差異**：正常案例的 `NT` 欄位是 `Performed successful`、`TR`（Tries）`=1`；房間 0330 這筆卻是 `Deleted from room 0330`、`TR=0`——代表 Protel 認為這筆晨喚**在還沒真正撥打電話前就被取消了**。

**根本原因**：`fiasHandler.ts` 的 `case 'WR'` 收到 `WR` 後，會自訂回送 `WC|RN<房號>|ST1` 當「已接受排程」的確認。但 `WC` 官方語意是**取消叫醒**，且規格明訂「No response is necessary to a WR or WC record」——這個自創的 ACK 完全不是規格要求的，還借用了官方「取消」的記錄類型，導致 Protel 把它當成一筆真正的取消請求處理，才會記錄「Deleted from room X」。

**修復**：`fiasHandler.ts` 的 `case 'WR'`、`case 'WC'` 都不再回送任何確認，改成依規格完全不回應；`docs/FIAS_INTEGRATION.md` 的 `WR`/`WC` 章節同步更新，移除錯誤的「系統 → PMS（回應）」說明。

---

## 3. DND 勿擾（RE）

```
[2026-07-08 13:04:25] [FiasClient] 收到原始訊息: RE|RN0527|DNY|
```

**觀察重點**
- 格式跟規格/我方實作一致：`RN`+`DN`（`Y`=開啟）
- 已確認完整流程可動：`RE` 收到 → 呼叫 FreeSwitch middleware `update()` 成功（見 `fiasWakeupResultHandler.ts`／`freeSwitchPmsApi.ts` 相關 log）

---

## 4. Posting calls（PS/PA）

尚未實測。已知：
- `PS`/`PA` 是我方主動送出、PMS 回應的方向，格式已依官方規格實作（`fiasHandler.ts` 目前收到 `PA` 只會印「未知訊息類型」，尚未真正處理回傳內容）
- 之前用 `/test-fias-result` 手動送過 `PS`，PMS 有正確回 `PA|RN0527|ASOK|...`，證實握手/收送正常，但這是手動模擬，還沒測過真實房客撥打電話觸發的完整流程

---

## 5. Room Move（實際走 GO + GI，不是 GC）

```
[2026-07-08 15:55:51] 訊息內容: {
  type: 'GO',
  fields: { RN: '0527', 'G#': '3932599', GS: 'N', DA: '260708', TI: '155551', '': '' }
}

[2026-07-08 15:55:51] 訊息內容: {
  type: 'GI',
  fields: {
    RN: '0330', 'G#': '3932599', GN: 'Test', CS: '0',
    DA: '260708', TI: '155551', GA: '260708', GD: '260709',
    GF: 'BOOKING', GG: '', GL: 'GE', GS: 'N', GT: '', GV: '',
    MR: 'MU', NP: 'N', TV: 'TU', VR: 'VN', 'G+': '1676055', '': ''
  }
}
```

**觀察重點（重要，跟原本假設不同）**
- **這台 Protel 換房不是送單一的 `GC`（帶 `RO` 舊房號）記錄，而是送一組 `GO`（退舊房）+`GI`（進新房）**，兩筆訊息的 `G#`（訂房編號）完全相同（`3932599`），以此判斷是同一筆訂房的搬移，不是兩個不相干的房客
- 符合官方規格 `RO` 欄位的註腳 6：「mandatory for systems which support room-moves **opposed to** C/O of the old room and C/I of the new room」——確認這台 Protel 走的是後者（C/O + C/I）
- **好消息**：我方 `fiasHandler.ts` 的 `case 'GO'`／`case 'GI'` 本來就各自獨立處理（收權限、開權限），這種 GO+GI 模式不需要額外開發，兩個 handler 各自觸發就能達到跟 `GC` 換房邏輯一樣的效果
- `case 'GC'` 目前完全沒被這台 Protel 觸發過，該邏輯（`fiasHandler.ts` 裡判斷 `RO` 欄位的部分）保留著以防萬一，但實務上可能用不到

---

## 6. Room Status（`POST /api/v1/lakeshore/room/status`）

測試成功。目前做法：**煙波 `roomstatus` 直接當 FIAS `RS` 送出，不做代碼轉換**（原本嘗試依 Oracle Appendix B 的 1-6 對照，實測發現跟這台 Protel 實際顯示不符，例如送 `RS5` 結果顯示「清潔中」而非官方定義的「已檢查」，詳見 `docs/FIAS_INTEGRATION.md` 的 RE 章節）。

---

## 7. Check-out（GO）

尚未單獨測試（第 5 項換房測試裡有出現 `GO`，格式可參考上方，但那是換房情境下的 `GO`，非單純退房，建議還是找機會單獨測一次一般退房）。

---

## 待確認/待處理事項彙總

1. **`GN` 中文姓名編碼**：目前唯一一筆範例是亂碼，需要真實中文姓名房客的 check-in 再驗證一次
2. **`HS` 欄位**：非官方欄位，目前忽略，若之後發現有業務意義再處理
3. **Posting calls**：尚未用真實房客撥打電話驗證完整流程（`PS` 送出 → `PA` 回應 → 我方是否需要處理 `PA` 內容）
4. **Check-out**：尚未單獨測試一般退房情境
5. **`GC`（換房）邏輯**：目前這台 Protel 用不到，程式碼保留但沒有實測驗證過
6. **`WC` 誤判為取消請求**：已修復（移除自訂 ACK），但**尚未用修復後的版本重新實測**，
   下次測 Morning call 時要確認 Protel 端不會再記錄 `Deleted from room X`
