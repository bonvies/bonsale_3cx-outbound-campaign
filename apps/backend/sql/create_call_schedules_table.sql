-- 建立 call_schedules 資料表
CREATE TABLE IF NOT EXISTS `call_schedules` (
  `id` VARCHAR(36) PRIMARY KEY COMMENT '唯一識別碼',
  `audio_file` VARCHAR(255) NOT NULL COMMENT '鈴聲檔案名稱',
  `date` DATETIME NOT NULL COMMENT '排程日期時間',
  `extension` VARCHAR(255) NOT NULL COMMENT '分機號碼',
  `call_status` ENUM('scheduling', 'completed', 'failed') NOT NULL DEFAULT 'scheduling' COMMENT '撥號狀態',
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
