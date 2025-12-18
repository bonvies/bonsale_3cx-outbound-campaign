import { useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  Box,
  Stack,
  Typography,
} from '@mui/material'
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs, { Dayjs } from 'dayjs'

export type CallScheduleFormData = {
  extension: string
  date: string
  retryInterval: string
  maxRetries: string
  notificationContent: string
  audioFile: string
  notes: string
}

type CallScheduleDialogProps = {
  mode?: 'add' | 'edit' | 'info'
  data?: CallScheduleFormData | null
  trigger?: (onClick: () => void) => ReactNode
  onSubmit?: (data: CallScheduleFormData) => void
}

export function CallScheduleDialog({
  mode = 'add',
  data = null,
  trigger,
  onSubmit
}: CallScheduleDialogProps) {
  const [open, setOpen] = useState(false)
  const [formData, setFormData] = useState<CallScheduleFormData>(data || {
    extension: '',
    date: dayjs().format('YYYY/MM/DD HH:mm'),
    retryInterval: '5',
    maxRetries: '3',
    notificationContent: '標準叫醒服務',
    audioFile: '預設鈴聲',
    notes: '',
  })

  const handleChange = (field: keyof CallScheduleFormData, value: string) => {
    setFormData({ ...formData, [field]: value })
  }

  const handleClose = () => {
    setOpen(false)
  }

  const handleSubmit = () => {
    onSubmit?.(formData)
    setOpen(false)
    // Reset form
    setFormData({
      extension: '',
      date: dayjs().format('YYYY/MM/DD HH:mm'),
      retryInterval: '5',
      maxRetries: '3',
      notificationContent: '標準叫醒服務',
      audioFile: '預設鈴聲',
      notes: '',
    })
  }

  return (
    <>
      {trigger && trigger(() => setOpen(true))}

      <Dialog open={open} onClose={handleClose} maxWidth={mode === 'info' ? 'sm' : 'xs'} fullWidth>
        <DialogTitle>
          <Typography variant="h6">{mode === 'add' ? '新增排程通話' : mode === 'edit' ? '編輯排程通話' : '自動語音通知明細'}</Typography>
        </DialogTitle>

        <DialogContent sx={{ pb: 0 }}>
          {mode === 'info' ? (
            <Box
              sx={{
                px: 2,
              }}
            >
              <Stack
                direction="row"
                spacing={2}
                alignItems="center"
                sx={{
                  py: 2,
                  borderBottom: '1px solid',
                  borderColor: 'divider'
                }}
              >
                <Typography variant='h5' flex='1' color="text.secondary" sx={{ mb: 3 }}>
                  呼叫詳情
                </Typography>
              </Stack>

              {/* 日期/時間 */}
              <Stack
                direction="row"
                spacing={2}
                alignItems="center"
                sx={{
                  p: 2,
                  borderBottom: '1px solid',
                  borderColor: 'divider'
                }}
              >
                <Typography variant="body1" sx={{ minWidth: 120 }}>
                  日期／時間
                </Typography>
                <Typography variant="body1">
                  {formData.date}
                </Typography>
              </Stack>

              {/* 分機號 */}
              <Stack
                direction="row"
                spacing={2}
                alignItems="center"
                sx={{
                  p: 2,
                  borderBottom: '1px solid',
                  borderColor: 'divider'
                }}
              >
                <Typography variant="body1" sx={{ minWidth: 120 }}>
                  分機號
                </Typography>
                <Typography variant="body1">
                  {formData.extension}
                </Typography>
              </Stack>

              {/* 撥號狀態 */}
              <Stack
                direction="row"
                spacing={2}
                alignItems="center"
                sx={{
                  p: 2,
                  borderBottom: '1px solid',
                  borderColor: 'divider'
                }}
              >
                <Typography variant="body1" sx={{ minWidth: 120 }}>
                  撥號狀態
                </Typography>
                <Typography variant="body1">
                  失敗
                </Typography>
              </Stack>

              {/* 撥號紀錄 */}
              <Stack
                direction="row"
                spacing={2}
                alignItems="center"
                sx={{
                  p: 2,
                  borderBottom: '1px solid',
                  borderColor: 'divider'
                }}
              >
                <Typography variant="body1" sx={{ minWidth: 120 }}>
                  撥號紀錄
                </Typography>
                <Typography variant="body1">
                  系統錯誤，無法完成撥號
                </Typography>
              </Stack>

              {/* 備註 */}
              <Stack
                direction="row"
                spacing={2}
                alignItems="center"
                sx={{ p: 2 }}
              >
                <Typography variant="body1" sx={{ minWidth: 120 }}>
                  備註
                </Typography>
                <Typography variant="body1">
                  {formData.notes || '-'}
                </Typography>
              </Stack>
            </Box>
          ) : (
            <Stack spacing={3} sx={{ mt: 1 }}>
              {/* 分機 */}
              <TextField
                fullWidth
                label="分機"
                value={formData.extension}
                onChange={(e) => handleChange('extension', e.target.value)}
              />

              {/* 日期和呼叫時間 */}
              <LocalizationProvider dateAdapter={AdapterDayjs}>
                <DateTimePicker
                  value={dayjs(formData.date, 'YYYY/MM/DD HH:mm')}
                  label="呼叫日期時間"
                  sx={{ width: '100%' }}
                  onChange={(newValue: Dayjs | null) => {
                    if (newValue) {
                      handleChange('date', newValue.format('YYYY/MM/DD HH:mm'))
                    }
                  }}
                  format="YYYY/MM/DD HH:mm"
                />
              </LocalizationProvider>

              {/* 重呼設定 */}
              <TextField
                fullWidth
                label="重試間隔 (分鐘)"
                select
                value={formData.retryInterval}
                onChange={(e) => handleChange('retryInterval', e.target.value)}
              >
                <MenuItem value="1">1 分鐘</MenuItem>
                <MenuItem value="3">3 分鐘</MenuItem>
                <MenuItem value="5">5 分鐘</MenuItem>
                <MenuItem value="10">10 分鐘</MenuItem>
              </TextField>

              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                重呼設定
              </Typography>

              <TextField
                fullWidth
                label="最多重試次數"
                select
                value={formData.maxRetries}
                onChange={(e) => handleChange('maxRetries', e.target.value)}
              >
                <MenuItem value="1">1 次</MenuItem>
                <MenuItem value="2">2 次</MenuItem>
                <MenuItem value="3">3 次</MenuItem>
                <MenuItem value="5">5 次</MenuItem>
              </TextField>

              {/* 通知內容和音檔名稱 */}
              <TextField
                fullWidth
                label="通知內容"
                select
                value={formData.notificationContent}
                onChange={(e) => handleChange('notificationContent', e.target.value)}
              >
                <MenuItem value="標準叫醒服務">標準叫醒服務</MenuItem>
                <MenuItem value="會議提醒">會議提醒</MenuItem>
                <MenuItem value="航班提醒">航班提醒</MenuItem>
                <MenuItem value="自訂訊息">自訂訊息</MenuItem>
              </TextField>

              <TextField
                fullWidth
                label="音檔名稱"
                select
                value={formData.audioFile}
                onChange={(e) => handleChange('audioFile', e.target.value)}
              >
                <MenuItem value="預設鈴聲">預設鈴聲</MenuItem>
                <MenuItem value="溫柔叫醒">溫柔叫醒</MenuItem>
                <MenuItem value="緊急鈴聲">緊急鈴聲</MenuItem>
              </TextField>

              {/* 備註 */}
              <TextField
                fullWidth
                label="備註"
                multiline
                rows={3}
                placeholder="例如：會議、趕飛機等"
                value={formData.notes}
                onChange={(e) => handleChange('notes', e.target.value)}
              />
            </Stack>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2 }}>
           {mode === 'info' ? (
              <Button onClick={handleClose} variant="contained" color="primary">
                確定
              </Button>
           ) : (
            <>
              <Button onClick={handleClose} variant="outlined" color="inherit">
                取消
              </Button>
              <Button onClick={handleSubmit} variant="contained" color="primary">
                {mode === 'add' ? '新增' : '儲存'}
              </Button>
            </>
           )}
          
        </DialogActions>
      </Dialog>
    </>
  )
}
