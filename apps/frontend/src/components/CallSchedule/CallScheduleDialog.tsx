import { type ReactNode, useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useState } from 'react'
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

// ── Zod schema ──────────────────────────────────────────────
const callScheduleSchema = z.object({
  id: z.string().optional(),
  extension: z.string().min(1, '分機為必填'),
  date: z.string().min(1, '日期時間為必填'),
  retryInterval: z.string().min(1, '重試間隔為必填'),
  maxRetries: z.string().min(1, '重試次數為必填'),
  notificationContent: z.string().min(1, '通知內容為必填'),
  audioFile: z.string().min(1, '音檔名稱為必填'),
  notes: z.string(),
})

export type CallScheduleFormData = z.infer<typeof callScheduleSchema>

// ── default values ───────────────────────────────────────────
const defaultValues: CallScheduleFormData = {
  extension: '',
  date: dayjs().format('YYYY/MM/DD HH:mm'),
  retryInterval: '5',
  maxRetries: '3',
  notificationContent: '標準叫醒服務',
  audioFile: '預設鈴聲',
  notes: '',
}

// ── props ────────────────────────────────────────────────────
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
  onSubmit,
}: CallScheduleDialogProps) {
  const [open, setOpen] = useState(false)

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CallScheduleFormData>({
    resolver: zodResolver(callScheduleSchema),
    defaultValues,
  })

  // 打開 dialog 時，edit/info mode 還原為當筆資料
  useEffect(() => {
    if (open) {
      reset((mode === 'edit' || mode === 'info') && data ? data : defaultValues)
    }
  }, [open, mode, data, reset])

  const handleOpen = () => setOpen(true)
  const handleClose = () => setOpen(false)

  const onValid = (formData: CallScheduleFormData) => {
    onSubmit?.(formData)
    setOpen(false)
  }

  return (
    <>
      {trigger && trigger(handleOpen)}

      <Dialog open={open} onClose={handleClose} maxWidth={mode === 'info' ? 'sm' : 'xs'} fullWidth>
        <DialogTitle>
          <Typography variant="h6">
            {mode === 'add' ? '新增排程通話' : mode === 'edit' ? '編輯排程通話' : '自動語音通知明細'}
          </Typography>
        </DialogTitle>

        <DialogContent sx={{ pb: 0 }}>
          {mode === 'info' ? (
            <Box sx={{ px: 2 }}>
              <Stack
                direction="row"
                spacing={2}
                alignItems="center"
                sx={{ py: 2, borderBottom: '1px solid', borderColor: 'divider' }}
              >
                <Typography variant='h5' flex='1' color="text.secondary" sx={{ mb: 3 }}>
                  呼叫詳情
                </Typography>
              </Stack>

              {[
                { label: '日期／時間', value: data?.date },
                { label: '分機號', value: data?.extension },
                { label: '撥號狀態', value: '失敗' },
                { label: '撥號紀錄', value: '系統錯誤，無法完成撥號' },
                { label: '備註', value: data?.notes || '-' },
              ].map(({ label, value }, i, arr) => (
                <Stack
                  key={label}
                  direction="row"
                  spacing={2}
                  alignItems="center"
                  sx={{ p: 2, ...(i < arr.length - 1 && { borderBottom: '1px solid', borderColor: 'divider' }) }}
                >
                  <Typography variant="body1" sx={{ minWidth: 120 }}>{label}</Typography>
                  <Typography variant="body1">{value}</Typography>
                </Stack>
              ))}
            </Box>
          ) : (
            <Stack spacing={3} sx={{ mt: 1 }}>
              {/* 分機 */}
              <Controller
                name="extension"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="分機"
                    error={!!errors.extension}
                    helperText={errors.extension?.message}
                  />
                )}
              />

              {/* 日期時間 */}
              <Controller
                name="date"
                control={control}
                render={({ field }) => (
                  <LocalizationProvider dateAdapter={AdapterDayjs}>
                    <DateTimePicker
                      label="呼叫日期時間"
                      value={dayjs(field.value, 'YYYY/MM/DD HH:mm')}
                      onChange={(newValue: Dayjs | null) => {
                        field.onChange(newValue ? newValue.format('YYYY/MM/DD HH:mm') : '')
                      }}
                      format="YYYY/MM/DD HH:mm"
                      sx={{ width: '100%' }}
                      slotProps={{
                        textField: {
                          error: !!errors.date,
                          helperText: errors.date?.message,
                        },
                      }}
                    />
                  </LocalizationProvider>
                )}
              />

              {/* 重試間隔 */}
              <Controller
                name="retryInterval"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="重試間隔 (分鐘)"
                    select
                    error={!!errors.retryInterval}
                    helperText={errors.retryInterval?.message}
                  >
                    <MenuItem value="1">1 分鐘</MenuItem>
                    <MenuItem value="3">3 分鐘</MenuItem>
                    <MenuItem value="5">5 分鐘</MenuItem>
                    <MenuItem value="10">10 分鐘</MenuItem>
                  </TextField>
                )}
              />

              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                重呼設定
              </Typography>

              {/* 最多重試次數 */}
              <Controller
                name="maxRetries"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="最多重試次數"
                    select
                    error={!!errors.maxRetries}
                    helperText={errors.maxRetries?.message}
                  >
                    <MenuItem value="1">1 次</MenuItem>
                    <MenuItem value="2">2 次</MenuItem>
                    <MenuItem value="3">3 次</MenuItem>
                    <MenuItem value="5">5 次</MenuItem>
                  </TextField>
                )}
              />

              {/* 通知內容 */}
              <Controller
                name="notificationContent"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="通知內容"
                    select
                    error={!!errors.notificationContent}
                    helperText={errors.notificationContent?.message}
                  >
                    <MenuItem value="標準叫醒服務">標準叫醒服務</MenuItem>
                    <MenuItem value="會議提醒">會議提醒</MenuItem>
                    <MenuItem value="航班提醒">航班提醒</MenuItem>
                    <MenuItem value="自訂訊息">自訂訊息</MenuItem>
                  </TextField>
                )}
              />

              {/* 音檔名稱 */}
              <Controller
                name="audioFile"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="音檔名稱"
                    select
                    error={!!errors.audioFile}
                    helperText={errors.audioFile?.message}
                  >
                    <MenuItem value="預設鈴聲">預設鈴聲</MenuItem>
                    <MenuItem value="溫柔叫醒">溫柔叫醒</MenuItem>
                    <MenuItem value="緊急鈴聲">緊急鈴聲</MenuItem>
                  </TextField>
                )}
              />

              {/* 備註 */}
              <Controller
                name="notes"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="備註"
                    multiline
                    rows={3}
                    placeholder="例如：會議、趕飛機等"
                    error={!!errors.notes}
                    helperText={errors.notes?.message}
                  />
                )}
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
              <Button onClick={handleSubmit(onValid)} variant="contained" color="primary">
                {mode === 'add' ? '新增' : '儲存'}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>
    </>
  )
}
