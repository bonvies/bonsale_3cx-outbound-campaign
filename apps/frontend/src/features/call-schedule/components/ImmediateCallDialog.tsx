import { type ReactNode, useState } from 'react'
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
import { triggerImmediateCall } from '../api/CallSchedule'

// ── Zod schema ──────────────────────────────────────────────
const immediateCallSchema = z.object({
  extension: z.string().min(1, '分機為必填'),
  retryInterval: z.string().min(1, '重試間隔為必填'),
  maxRetries: z.string().min(1, '重試次數為必填'),
  notificationContent: z.string().min(1, '通知內容為必填'),
  audioFile: z.string().min(1, '音檔名稱為必填'),
  notes: z.string(),
  roomNum: z.string().optional(),
})

type ImmediateCallFormData = z.infer<typeof immediateCallSchema>

const defaultValues: ImmediateCallFormData = {
  extension: '',
  retryInterval: '5',
  maxRetries: '0',
  notificationContent: '標準叫醒服務',
  audioFile: '預設鈴聲',
  notes: '',
  roomNum: '',
}

type ImmediateCallDialogProps = {
  trigger?: (onClick: () => void) => ReactNode
  onSuccess?: () => void
}

export function ImmediateCallDialog({ trigger, onSuccess }: ImmediateCallDialogProps) {
  const [open, setOpen] = useState(false)

  const { control, handleSubmit, reset } = useForm<ImmediateCallFormData>({
    resolver: zodResolver(immediateCallSchema),
    defaultValues,
  })

  const handleOpen = () => {
    reset(defaultValues)
    setOpen(true)
  }
  const handleClose = () => setOpen(false)

  const handleSubmitData = () => {
    handleSubmit(async (formData) => {
      const loadingToast = toast.custom(
        <Alert icon={false} severity="info">
          <Stack direction="row" alignItems="center" spacing={2}>
            <CircularProgress size={20} />
            <Typography>撥打中...</Typography>
          </Stack>
        </Alert>,
        { duration: Infinity },
      )
      try {
        await triggerImmediateCall({
          ...formData,
          roomNum: formData.roomNum || undefined,
        })
        toast.custom(
          <Alert severity="success" variant="filled">
            撥打成功
          </Alert>,
        )
        onSuccess?.()
        setOpen(false)
      } catch (err) {
        console.error('[ImmediateCallDialog] submit error:', err)
        toast.custom(
          t => (
            <Alert severity="error" onClose={() => toast.remove(t.id)}>
              撥打失敗，請稍後再試
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
        <DialogTitle>立即撥打</DialogTitle>

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

            {/* 房間號碼 */}
            <Controller
              name="roomNum"
              control={control}
              render={({ field: { value, onChange, ref }, fieldState: { error } }) => (
                <TextField
                  value={value}
                  onChange={onChange}
                  inputRef={ref}
                  fullWidth
                  label="房間號碼"
                  placeholder="例如：10001"
                  error={!!error}
                  helperText={error?.message}
                />
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
                  <MenuItem value="0">0 次</MenuItem>
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
          <Button onClick={handleClose} variant="outlined" color="inherit">
            取消
          </Button>
          <Button onClick={handleSubmitData} variant="contained" color="primary">
            立即撥打
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
