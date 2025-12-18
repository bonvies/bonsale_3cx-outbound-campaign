import { useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
} from '@mui/material'

type DeleteConfirmDialogProps = {
  trigger: (onClick: () => void) => ReactNode
  onConfirm: () => void
}

export function DeleteConfirmDialog({ trigger, onConfirm }: DeleteConfirmDialogProps) {
  const [open, setOpen] = useState(false)

  const handleOpen = () => {
    setOpen(true)
  }

  const handleClose = () => {
    setOpen(false)
  }

  const handleConfirm = () => {
    onConfirm()
    setOpen(false)
  }

  return (
    <>
      {trigger(handleOpen)}

      <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
        <DialogTitle>
          <Typography variant="h6">確認刪除</Typography>
        </DialogTitle>

        <DialogContent>
          <Typography variant="body1">
            確定要刪除這筆紀錄嗎？此操作無法復原
          </Typography>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={handleClose} variant="outlined" color="inherit">
            取消
          </Button>
          <Button onClick={handleConfirm} variant="contained" color="primary">
            確認
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
