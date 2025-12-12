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
  IconButton,
  Typography,
} from '@mui/material'
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { Close } from '@mui/icons-material'
import dayjs, { Dayjs } from 'dayjs'

export interface CallScheduleFormData {
  extension: string
  date: string
  retryInterval: string
  maxRetries: string
  notificationContent: string
  audioFile: string
  notes: string
}

interface CallScheduleDialogProps {
  mode?: 'add' | 'edit'
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

      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h6">{mode === 'add' ? '新增' : '編輯'}排程通話</Typography>
            <IconButton onClick={handleClose} size="small">
              <Close />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent dividers>
          {/* 分機 */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
              分機
            </Typography>
            <TextField
              fullWidth
              placeholder="請選擇或輸入分機"
              value={formData.extension}
              onChange={(e) => handleChange('extension', e.target.value)}
              size="small"
            />
          </Box>

          {/* 日期和呼叫時間 */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
              日期與時間
            </Typography>
            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <DateTimePicker
                value={dayjs(formData.date, 'YYYY/MM/DD HH:mm')}
                onChange={(newValue: Dayjs | null) => {
                  if (newValue) {
                    handleChange('date', newValue.format('YYYY/MM/DD HH:mm'))
                  }
                }}
                format="YYYY/MM/DD HH:mm"
                slotProps={{
                  textField: {
                    fullWidth: true,
                    size: 'small',
                  },
                }}
              />
            </LocalizationProvider>
          </Box>

          {/* 重呼設定 */}
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
            重呼設定
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                重試間隔（分鐘）
              </Typography>
              <TextField
                fullWidth
                select
                value={formData.retryInterval}
                onChange={(e) => handleChange('retryInterval', e.target.value)}
                size="small"
              >
                <MenuItem value="1">1 分鐘</MenuItem>
                <MenuItem value="3">3 分鐘</MenuItem>
                <MenuItem value="5">5 分鐘</MenuItem>
                <MenuItem value="10">10 分鐘</MenuItem>
              </TextField>
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                最多重試次數
              </Typography>
              <TextField
                fullWidth
                select
                value={formData.maxRetries}
                onChange={(e) => handleChange('maxRetries', e.target.value)}
                size="small"
              >
                <MenuItem value="1">1 次</MenuItem>
                <MenuItem value="2">2 次</MenuItem>
                <MenuItem value="3">3 次</MenuItem>
                <MenuItem value="5">5 次</MenuItem>
              </TextField>
            </Box>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 3, display: 'block' }}>
            每 {formData.retryInterval} 分鐘重試，最多 {formData.maxRetries} 次
          </Typography>

          {/* 通知內容和音檔名稱 */}
          <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
                通知內容
              </Typography>
              <TextField
                fullWidth
                select
                value={formData.notificationContent}
                onChange={(e) => handleChange('notificationContent', e.target.value)}
                size="small"
              >
                <MenuItem value="標準叫醒服務">標準叫醒服務</MenuItem>
                <MenuItem value="會議提醒">會議提醒</MenuItem>
                <MenuItem value="航班提醒">航班提醒</MenuItem>
                <MenuItem value="自訂訊息">自訂訊息</MenuItem>
              </TextField>
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
                音檔名稱
              </Typography>
              <TextField
                fullWidth
                select
                value={formData.audioFile}
                onChange={(e) => handleChange('audioFile', e.target.value)}
                size="small"
              >
                <MenuItem value="預設鈴聲">預設鈴聲</MenuItem>
                <MenuItem value="溫柔叫醒">溫柔叫醒</MenuItem>
                <MenuItem value="緊急鈴聲">緊急鈴聲</MenuItem>
              </TextField>
            </Box>
          </Box>

          {/* 備註 */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
              備註（選填）
            </Typography>
            <TextField
              fullWidth
              multiline
              rows={3}
              placeholder="例如：會議、趕飛機等"
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              size="small"
            />
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={handleClose} variant="outlined" color="inherit">
            取消
          </Button>
          <Button onClick={handleSubmit} variant="contained" color="primary">
            {mode === 'add' ? '新增' : '儲存'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
