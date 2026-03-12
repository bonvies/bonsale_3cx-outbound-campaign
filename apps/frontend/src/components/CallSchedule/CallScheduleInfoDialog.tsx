import { type ReactNode, useState } from 'react'
import useSWR from 'swr'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Stack,
  Typography,
} from '@mui/material'
import { format } from 'date-fns'
import { fetchCallScheduleById } from '../../api/CallSchedule'

type CallScheduleInfoDialogProps = {
  id?: string
  trigger?: (onClick: () => void) => ReactNode
}

export function CallScheduleInfoDialog({
  id,
  trigger,
}: CallScheduleInfoDialogProps) {
  const [open, setOpen] = useState(false)

  const { data: fetchedData } = useSWR(
    open && id ? id : null,
    fetchCallScheduleById,
  )

  const display = fetchedData

  return (
    <>
      {trigger && trigger(() => setOpen(true))}

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth='sm' fullWidth>
        <DialogTitle>自動語音通知明細</DialogTitle>

        <DialogContent sx={{ pb: 0 }}>
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
              { label: '呼叫日期時間', value: display?.date ? format(new Date(display.date), 'yyyy/MM/dd HH:mm') : '-' },
              { label: '分機號', value: display?.extension },
              { label: '音檔名稱', value: display?.audioFile || '-' },
              { label: '撥號狀態', value: display?.callStatus ?? '-' },
              { label: '撥號紀錄', value: display?.callRecord || '-' },
              { label: '備註', value: display?.notes || '-' },
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
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setOpen(false)} variant="contained" color="primary">
            確定
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
