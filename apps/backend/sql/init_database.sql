-- ====================================
-- 資料庫初始化腳本
-- ====================================

-- 1. 建立資料庫（如果不存在）
CREATE DATABASE IF NOT EXISTS `callSchedule`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- 2. 使用該資料庫
USE `callSchedule`;

-- 3. 建立 call_schedules 資料表
CREATE TABLE IF NOT EXISTS `call_schedules` (
  `id` VARCHAR(36) PRIMARY KEY COMMENT '唯一識別碼',
  `audio_file` VARCHAR(255) NOT NULL COMMENT '鈴聲檔案名稱',
  `date` DATETIME NOT NULL COMMENT '排程日期時間',
  `extension` VARCHAR(255) NOT NULL COMMENT '分機號碼',
  `call_status` ENUM('排程中', '已完成', '失敗') NOT NULL DEFAULT '排程中' COMMENT '撥號狀態',
  `call_record` TEXT NULL COMMENT '撥號紀錄',
  `notes` TEXT NULL COMMENT '備註',
  `notification_content` VARCHAR(255) NOT NULL COMMENT '通知內容',
  `retry_interval` INT NOT NULL COMMENT '重試間隔（分鐘）',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '建立時間',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新時間',
  INDEX `idx_date` (`date`),
  INDEX `idx_extension` (`extension`),
  INDEX `idx_call_status` (`call_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通話排程表';

-- 4. 插入測試資料
INSERT INTO `call_schedules`
  (`id`, `audio_file`, `date`, `extension`, `call_status`, `call_record`, `notes`, `notification_content`, `retry_interval`)
VALUES
  ('1', '預設鈴聲', '2025-12-05 07:30:00', 'A館 10F - 1002', '排程中', '-', '', '標準叫醒服務', 5),
  ('2', '預設鈴聲', '2025-12-05 06:30:00', 'B館 11F - 1108', '排程中', '-', '明天會議叫醒', '標準叫醒服務', 5),
  ('3', '預設鈴聲', '2025-12-04 06:30:00', 'B館 11F - 1108', '排程中', '-', '', '標準叫醒服務', 5),
  ('4', '預設鈴聲', '2025-12-04 06:00:00', 'B館 11F - 1101', '已完成', '已接聽', '', '標準叫醒服務', 5),
  ('5', '預設鈴聲', '2025-12-03 07:15:00', 'B館 11F - 1108', '排程中', '-', '', '標準叫醒服務', 5),
  ('6', '預設鈴聲', '2025-12-03 06:45:00', 'B館 11F - 1103', '失敗', '未接聽', '', '標準叫醒服務', 5),
  ('7', '預設鈴聲', '2025-12-03 06:30:00', 'B館 11F - 1108', '排程中', '-', '', '標準叫醒服務', 5),
  ('8', '預設鈴聲', '2025-12-03 06:00:00', 'B館 11F - 1108', '已完成', '已接聽', '提醒飛機起飛時間', '標準叫醒服務', 5),
  ('9', '預設鈴聲', '2025-12-03 05:30:00', 'C館 12F - 1201', '已完成', '已接聽 — 車呼成功', '', '標準叫醒服務', 5),
  ('10', '預設鈴聲', '2025-12-02 09:00:00', 'B館 11F - 1108', '失敗', '系統錯誤，無法完成撥號', '', '標準叫醒服務', 5);

-- 完成
SELECT '✅ 資料庫初始化完成！' AS status;
