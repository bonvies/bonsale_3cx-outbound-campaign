import { Box, TextField, MenuItem, Button, Stack } from '@mui/material'
import { DateTimePicker } from '@mui/x-date-pickers'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { renderTimeViewClock } from '@mui/x-date-pickers'
import dayjs, { type Dayjs } from 'dayjs'
import type { CallScheduleFilters as FilterType } from '../../types/callSchedule'

interface CallScheduleFiltersProps {
  filters: FilterType
  onFiltersChange: (filters: FilterType) => void
  onClear: () => void
  onSearch: () => void
}

export function CallScheduleFilters({
  filters,
  onFiltersChange,
  onClear,
  onSearch,
}: CallScheduleFiltersProps) {
  const handleStartDateChange = (newValue: Dayjs | null) => {
    onFiltersChange({ ...filters, startDate: newValue?.toDate() || null })
  }

  const handleEndDateChange = (newValue: Dayjs | null) => {
    onFiltersChange({ ...filters, endDate: newValue?.toDate() || null })
  }

  const handleStatusChange = (status: string) => {
    onFiltersChange({ ...filters, status })
  }

  const handleSearchChange = (search: string) => {
    onFiltersChange({ ...filters, search })
  }

  return (
    <Box
      sx={{
        p: 2,
        bgcolor: 'background.paper',
        borderRadius: 1,
      }}
    >
      {/* First row: Filter fields */}
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <DateTimePicker
            label="建立時間（起）"
            value={filters.startDate ? dayjs(filters.startDate) : null}
            onChange={handleStartDateChange}
            format='yyyy/MM/dd HH:mm'
            views={['year', 'month', 'day', 'hours', 'minutes']}
            ampm={false}
            viewRenderers={{
              hours: renderTimeViewClock,
              minutes: renderTimeViewClock,
              seconds: renderTimeViewClock,
            }}
            sx={{ width: '100%' }}
          />
        </LocalizationProvider>

        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <DateTimePicker
            label="建立時間（訖）"
            value={filters.endDate ? dayjs(filters.endDate) : null}
            onChange={handleEndDateChange}
            format='yyyy/MM/dd HH:mm'
            views={['year', 'month', 'day', 'hours', 'minutes']}
            ampm={false}
            viewRenderers={{
              hours: renderTimeViewClock,
              minutes: renderTimeViewClock,
              seconds: renderTimeViewClock,
            }}
            sx={{ width: '100%' }}
          />
        </LocalizationProvider>

        <TextField
          select
          label="撥號狀態"
          value={filters.status}
          onChange={(e) => handleStatusChange(e.target.value)}
          sx={{ width: '100%' }}
        >
          <MenuItem value="全部">全部</MenuItem>
          <MenuItem value="排程中">排程中</MenuItem>
          <MenuItem value="已完成">已完成</MenuItem>
          <MenuItem value="失敗">失敗</MenuItem>
        </TextField>

        <TextField
          label="分機"
          placeholder="請選擇或輸入分機"
          value={filters.search}
          onChange={(e) => handleSearchChange(e.target.value)}
          sx={{ width: '100%' }}
        />
      </Stack>

      {/* Second row: Action buttons (right aligned) */}
      <Stack direction="row" spacing={2} justifyContent="flex-end" flex={4}>
        <Box sx={{ flexGrow: 2 }}></Box>
        <Button
          variant="outlined"
          onClick={onClear}
          sx={{ flexGrow: 1 }}
        >
          清除
        </Button>

        <Button
          variant="contained"
          onClick={onSearch}
          sx={{ flexGrow: 1 }}
        >
          搜尋
        </Button>
      </Stack>
    </Box>
  )
}
