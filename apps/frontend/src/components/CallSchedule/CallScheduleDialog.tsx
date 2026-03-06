import { type ReactNode, useEffect, useState } from 'react'
import useSWR from 'swr'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material'
import toast from 'react-hot-toast'
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns'
import { format, parse, isValid } from 'date-fns'
import { createCallSchedule, updateCallSchedule, fetchCallScheduleById } from '../../api/callSchedule'

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
  date: format(new Date(), 'yyyy/MM/dd HH:mm'),
  retryInterval: '5',
  maxRetries: '3',
  notificationContent: '標準叫醒服務',
  audioFile: '預設鈴聲',
  notes: '',
}

// ── props ────────────────────────────────────────────────────
type CallScheduleDialogProps = {
  mode?: 'add' | 'edit'
  id?: string
  trigger?: (onClick: () => void) => ReactNode
  onSuccess?: () => void
}

export function CallScheduleDialog({
  mode = 'add',
  id,
  trigger,
  onSuccess,
}: CallScheduleDialogProps) {
  const [open, setOpen] = useState(false)

  const { data: fetchedData } = useSWR(
    open && mode === 'edit' && id ? id : null,
    fetchCallScheduleById,
  )

  const { control, handleSubmit, reset } = useForm<CallScheduleFormData>({
    resolver: zodResolver(callScheduleSchema),
    defaultValues,
  })

  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && fetchedData) {
      reset({
        id: fetchedData.id,
        extension: fetchedData.extension,
        date: fetchedData.date ? format(new Date(fetchedData.date), 'yyyy/MM/dd HH:mm') : '',
        retryInterval: fetchedData.retryInterval,
        maxRetries: fetchedData.maxRetries ?? '3',
        notificationContent: fetchedData.notificationContent,
        audioFile: fetchedData.audioFile,
        notes: fetchedData.notes ?? '',
      })
    } else if (mode === 'add') {
      reset(defaultValues)
    }
  }, [open, mode, fetchedData, reset])

  const handleOpen = () => setOpen(true)
  const handleClose = () => setOpen(false)

  const handleSubmitData = () => {
    handleSubmit(async (formData) => {
      const loadingToast = toast.custom(
        <Alert icon={false} severity="info">
          <Stack direction="row" alignItems="center" spacing={2}>
            <CircularProgress size={20} />
            <Typography>{mode === 'edit' ? '更新中...' : '新增中...'}</Typography>
          </Stack>
        </Alert>,
        { duration: Infinity },
      )
      try {
        console.log('[CallScheduleDialog] submit data:', formData)
        const payload = { ...formData, date: new Date(formData.date).toISOString() }
        if (mode === 'edit' && formData.id) {
          await updateCallSchedule(formData.id, payload)
        } else {
          await createCallSchedule(payload)
        }
        toast.custom(
          <Alert severity="success" variant="filled">
            {mode === 'edit' ? '更新成功' : '新增成功'}
          </Alert>,
        )
        onSuccess?.()
        setOpen(false)
      } catch (err) {
        console.error('[CallScheduleDialog] submit error:', err)
        toast.custom(
          t => (
            <Alert severity="error" onClose={() => toast.remove(t.id)}>
              {mode === 'edit' ? '更新失敗，請稍後再試' : '新增失敗，請稍後再試'}
            </Alert>
          ),
          { duration: Infinity },
        )
      } finally {
        toast.remove(loadingToast)
      }
    })()
  }

  return (
    <>
      {trigger && trigger(handleOpen)}

      <Dialog open={open} onClose={handleClose} maxWidth='sm' fullWidth>
        <DialogTitle>
          {mode === 'add' ? '新增排程通話' : '編輯排程通話'}
        </DialogTitle>

        <DialogContent sx={{ pb: 0 }}>
          <Stack spacing={3} sx={{ mt: 1 }}>
            {/* 分機 */}
            <Controller
              name="extension"
              control={control}
              render={({ field: { value, onChange, ref }, fieldState: { error } }) => (
                <TextField
                  value={value}
                  onChange={onChange}
                  inputRef={ref}
                  fullWidth
                  label="分機"
                  error={!!error}
                  helperText={error?.message}
                  required
                />
              )}
            />

            {/* 日期時間 */}
            <Controller
              name="date"
              control={control}
              render={({ field: { value, onChange }, fieldState: { error } }) => (
                <LocalizationProvider dateAdapter={AdapterDateFns}>
                  <DateTimePicker
                    label="呼叫日期時間"
                    value={(() => {
                      const parsed = parse(value, 'yyyy/MM/dd HH:mm', new Date())
                      return isValid(parsed) ? parsed : null
                    })()}
                    onChange={(newValue: Date | null) => {
                      onChange(newValue && isValid(newValue) ? format(newValue, 'yyyy/MM/dd HH:mm') : '')
                    }}
                    format="yyyy/MM/dd HH:mm"
                    sx={{ width: '100%' }}
                    slotProps={{
                      textField: {
                        required: true,
                        error: !!error,
                        helperText: error?.message,
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
              render={({ field: { value, onChange, ref }, fieldState: { error } }) => (
                <TextField
                  value={value}
                  onChange={onChange}
                  inputRef={ref}
                  fullWidth
                  label="重試間隔 (分鐘)"
                  select
                  error={!!error}
                  helperText={error?.message}
                  required
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
              render={({ field: { value, onChange, ref }, fieldState: { error } }) => (
                <TextField
                  value={value}
                  onChange={onChange}
                  inputRef={ref}
                  fullWidth
                  label="最多重試次數"
                  select
                  error={!!error}
                  helperText={error?.message}
                  required
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
              render={({ field: { value, onChange, ref }, fieldState: { error } }) => (
                <TextField
                  value={value}
                  onChange={onChange}
                  inputRef={ref}
                  fullWidth
                  label="通知內容"
                  select
                  error={!!error}
                  helperText={error?.message}
                  required
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
              render={({ field: { value, onChange, ref }, fieldState: { error } }) => (
                <TextField
                  value={value}
                  onChange={onChange}
                  inputRef={ref}
                  fullWidth
                  label="音檔名稱"
                  select
                  error={!!error}
                  helperText={error?.message}
                  required
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
              render={({ field: { value, onChange, ref }, fieldState: { error } }) => (
                <TextField
                  value={value}
                  onChange={onChange}
                  inputRef={ref}
                  fullWidth
                  label="備註"
                  multiline
                  rows={3}
                  placeholder="例如：會議、趕飛機等"
                  error={!!error}
                  helperText={error?.message}
                />
              )}
            />
          </Stack>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2 }}>
          <>
            <Button onClick={handleClose} variant="outlined" color="inherit">
              取消
            </Button>
            <Button onClick={handleSubmitData} variant="contained" color="primary">
              {mode === 'add' ? '新增' : '儲存'}
            </Button>
          </>
        </DialogActions>
      </Dialog>
    </>
  )
}
