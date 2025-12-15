import { Box, TextField, MenuItem, Button, Grid, Select, FormControl, InputLabel } from '@mui/material'
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

  const handleStatusChange = (value: string | string[]) => {
    const statusArray = typeof value === 'string' ? [value] : value
    // 如果陣列為空,設定為 ['全部']
    const finalStatus = statusArray.length === 0 ? ['全部'] : statusArray.filter(s => s !== '全部')
    onFiltersChange({ ...filters, status: finalStatus })
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
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={3}>
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <DateTimePicker
              label="建立時間（起）"
              value={filters.startDate ? dayjs(filters.startDate) : null}
              onChange={handleStartDateChange}
              format='YYYY/MM/DD HH:mm'
              views={['year', 'month', 'day', 'hours', 'minutes']}
              ampm={false}
              viewRenderers={{
                hours: renderTimeViewClock,
                minutes: renderTimeViewClock,
                seconds: renderTimeViewClock,
              }}
              slotProps={{
                textField: {
                  placeholder: 'YYYY/MM/DD HH:mm',
                  fullWidth: true
                }
              }}
            />
          </LocalizationProvider>
        </Grid>

        <Grid size={3}>
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <DateTimePicker
              label="建立時間（訖）"
              value={filters.endDate ? dayjs(filters.endDate) : null}
              onChange={handleEndDateChange}
              format='YYYY/MM/DD HH:mm'
              views={['year', 'month', 'day', 'hours', 'minutes']}
              ampm={false}
              viewRenderers={{
                hours: renderTimeViewClock,
                minutes: renderTimeViewClock,
                seconds: renderTimeViewClock,
              }}
              slotProps={{
                textField: {
                  placeholder: 'YYYY/MM/DD HH:mm',
                  fullWidth: true
                }
              }}
            />
          </LocalizationProvider>
        </Grid>

        <Grid size={3}>
          <FormControl fullWidth>
            <InputLabel>撥號狀態</InputLabel>
            <Select
              label="撥號狀態"
              value={filters.status.includes('全部') ? [] : filters.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              multiple
              renderValue={(selected) => {
                const selectedArray = selected as string[]
                if (selectedArray.length === 0) {
                  return '全部'
                }
                return selectedArray.join(', ')
              }}
            >
              <MenuItem value="排程中">排程中</MenuItem>
              <MenuItem value="已完成">已完成</MenuItem>
              <MenuItem value="失敗">失敗</MenuItem>
            </Select>
          </FormControl>
        </Grid>

        <Grid size={3}>
          <TextField
            label="分機"
            placeholder="請選擇或輸入分機"
            value={filters.search}
            onChange={(e) => handleSearchChange(e.target.value)}
            fullWidth
          />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={3} />
        <Grid size={3} />
        <Grid size={3}>
          <Button
            variant="outlined"
            onClick={onClear}
            fullWidth
          >
            清除
          </Button>
        </Grid>

        <Grid size={3}>
          <Button
            variant="contained"
            onClick={onSearch}
            fullWidth
          >
            搜尋
          </Button>
        </Grid>
      </Grid>
    </Box>
  )
}
