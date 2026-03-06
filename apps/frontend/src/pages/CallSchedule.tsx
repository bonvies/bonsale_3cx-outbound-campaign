import { useState, useMemo } from 'react'
import useSWR from 'swr'
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  IconButton,
  Typography,
  Button,
  Chip,
  Pagination,
  Stack,
} from '@mui/material'
import {
  Edit,
  Add,
  DeleteOutlineOutlined,
  InfoOutlined,
  Refresh,
} from '@mui/icons-material'
import { format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import type { CallScheduleFilters as FilterType } from '../types/callSchedule'
import { CallScheduleDialog } from '../components/CallSchedule/CallScheduleDialog'
import { CallScheduleInfoDialog } from '../components/CallSchedule/CallScheduleInfoDialog'
import { CallScheduleFilters } from '../components/CallSchedule/CallScheduleFilters'
import { DeleteConfirmDialog } from '../components/CallSchedule/DeleteConfirmDialog'
import {
  fetchCallSchedules,
  deleteCallSchedule,
  type FetchCallSchedulesParams,
} from '../api/CallSchedule'
import { fetchBonsaleCompany } from '../api/Bonsale'

const PAGE_SIZE = 10

function formatLocalDate(isoString: string, timezoneIANA: string): string {
  console.log('Original ISO String:', isoString); // --- DEBUG ---
  console.log('Timezone IANA:', timezoneIANA); // --- DEBUG ---
  console.log('Parsed Date:', toZonedTime(new Date(isoString), timezoneIANA)); // --- DEBUG ---
  return format(toZonedTime(new Date(isoString), timezoneIANA), 'yyyy/MM/dd HH:mm:ss')
}

const defaultFilters: FilterType = {
  startDate: null,
  endDate: null,
  status: ['全部'],
  extension: '',
}

type FilterChipKey = 'extension' | 'startDate' | 'endDate' | 'status'

export default function CallSchedule() {
  // 篩選 UI 的 draft 狀態（用戶正在編輯中）
  const [filters, setFilters] = useState<FilterType>(defaultFilters)

  // SWR 實際抓取的參數（按下搜尋後才更新）
  const [fetchParams, setFetchParams] = useState<FetchCallSchedulesParams>({
    page: 1,
    limit: PAGE_SIZE,
    sort: 'created_at',
    order: 'desc',
  })

  const { data, mutate } = useSWR(fetchParams, fetchCallSchedules)
  const { data: bonsaleCompanySysData } = useSWR('bonsaleCompanySys', fetchBonsaleCompany) 
  console.log('Bonsale Company Sys Data:', bonsaleCompanySysData) // --- DEBUG ---
  const timezoneIANA = bonsaleCompanySysData?.timezoneIANA || 'UTC'


  const records = data?.data ?? []
  const totalCount = data?.total ?? 0
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  const handleSearch = () => {
    setFetchParams(prev => ({
      page: 1,
      limit: PAGE_SIZE,
      sort: prev.sort,
      order: prev.order,
      ...(filters.extension.trim() && { extension: filters.extension.trim() }),
      ...(filters.startDate && { startDate: format(new Date(filters.startDate), 'yyyy/MM/dd HH:mm') }),
      ...(filters.endDate && { endDate: format(new Date(filters.endDate), 'yyyy/MM/dd HH:mm') }),
      ...(!filters.status.includes('全部') && { status: filters.status.join(',') }),
    }))
  }

  const handleClearFilters = () => {
    setFilters(defaultFilters)
    setFetchParams(prev => ({ page: 1, limit: PAGE_SIZE, sort: prev.sort, order: prev.order }))
  }

  const handleRemoveFilter = (key: FilterChipKey) => {
    const newFilters = { ...filters }
    if (key === 'extension') newFilters.extension = ''
    else if (key === 'startDate') newFilters.startDate = null
    else if (key === 'endDate') newFilters.endDate = null
    else if (key === 'status') newFilters.status = ['全部']
    setFilters(newFilters)
    setFetchParams(prev => ({ ...prev, page: 1, [key]: undefined }))
  }

  const handlePageChange = (_: React.ChangeEvent<unknown>, value: number) => {
    setFetchParams(prev => ({ ...prev, page: value }))
  }

  const handleDeleteSchedule = async (id: string) => {
    try {
      await deleteCallSchedule(id)
      mutate()
    } catch (err) {
      console.error('Failed to delete call schedule:', err)
    }
  }

  // 從已提交的 fetchParams 直接推導 chips，不需要 isSearchActive
  const activeFilters = useMemo(() => {
    const chips: Array<{ key: FilterChipKey; label: string }> = []
    if (fetchParams.extension) chips.push({ key: 'extension', label: `分機: ${fetchParams.extension}` })
    if (fetchParams.startDate) chips.push({ key: 'startDate', label: `建立時間（起）: ${fetchParams.startDate}` })
    if (fetchParams.endDate) chips.push({ key: 'endDate', label: `建立時間（訖）: ${fetchParams.endDate}` })
    if (fetchParams.status) chips.push({ key: 'status', label: `撥號狀態: ${fetchParams.status}` })
    return chips
  }, [fetchParams])

  const getStatusColor = (status: string) => {
    switch (status) {
      case '排程中': return 'warning'
      case '已完成': return 'success'
      case '失敗':   return 'error'
      default:       return 'default'
    }
  }

  return (
    <>
      {/* Filters */}
      <CallScheduleFilters
        filters={filters}
        onFiltersChange={setFilters}
        onClear={handleClearFilters}
        onSearch={handleSearch}
      />

      {/* Action Buttons */}
      <Stack
        direction='row'
        spacing={2}
        alignItems='center'
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          paddingY: 2,
          borderBottom: '1px solid #eee',
        }}
      >
        <CallScheduleDialog
          mode="add"
          onSuccess={mutate}
          trigger={(onClick) => (
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={onClick}
              sx={{
                minWidth: '100px',
                bgcolor: (theme) => theme.palette.secondary.main,
              }}
            >
              新增
            </Button>
          )}
        />
        <IconButton
          size="small"
          color="primary"
          title="重新整理"
          onClick={() => mutate()}
        >
          <Refresh />
        </IconButton>

        <Box sx={{ ml: 'auto' }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              共 {totalCount} 筆
            </Typography>
            <Pagination
              count={totalPages}
              page={fetchParams.page}
              onChange={handlePageChange}
              size="small"
              color="primary"
            />
          </Stack>
        </Box>
      </Stack>

      {/* Table */}
      <Box
        sx={{
          height: '100%',
          maxHeight: '100%',
          overflowY: 'auto'
        }}
      >
        {/* Active Filter Chips */}
        {activeFilters.length > 0 && (
          <Box
            sx={{
              py: 1.5,
              px: 2,
              bgcolor: 'background.paper',
              borderRadius: 1,
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" gap={1}>
              {activeFilters.map((filter) => (
                <Chip
                  key={filter.key}
                  label={filter.label}
                  onDelete={() => handleRemoveFilter(filter.key)}
                  size="small"
                />
              ))}
            </Stack>
          </Box>
        )}
        <Table stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell align='center' sx={{ width: '150px' }}>
                日期／時間
              </TableCell>
              <TableCell align='center' sx={{ width: '120px' }}>
                分機號
              </TableCell>
              <TableCell align='center' sx={{ width: '100px' }}>
                撥號狀態
              </TableCell>
              <TableCell align='center' sx={{ width: '200px' }}>
                撥號紀錄
              </TableCell>
              <TableCell align='center' sx={{ width: '150px' }}>
                備註
              </TableCell>
              <TableCell align='center' sx={{ width: '120px' }}>
                動作
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody sx={{ backgroundColor: 'white' }}>
            {records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ height: '100%', borderBottom: 'none', color: '#888', py: 4, fontSize: '1.5rem' }}>
                  沒有資料
                </TableCell>
              </TableRow>
            ) : (
              records.map((row) => (
                <TableRow key={row.id}>
                  <TableCell align='center'>{formatLocalDate(row.date, timezoneIANA)}</TableCell>
                  <TableCell align='center'>{row.extension}</TableCell>
                  <TableCell align='center'>
                    <Chip
                      label={row.callStatus}
                      color={getStatusColor(row.callStatus)}
                      size="small"
                    />
                  </TableCell>
                  <TableCell align='center'>{row.callRecord || '-'}</TableCell>
                  <TableCell align='center'>{row.notes || '-'}</TableCell>
                  <TableCell align='center'>
                    <Stack direction='row' justifyContent='center'>
                      <CallScheduleDialog
                        mode="edit"
                        id={row.id}
                        onSuccess={mutate}
                        trigger={(onClick) => (
                          <IconButton onClick={onClick}>
                            <Edit />
                          </IconButton>
                        )}
                      />
                      <CallScheduleInfoDialog
                        id={row.id}
                        trigger={(onClick) => (
                          <IconButton onClick={onClick}>
                            <InfoOutlined />
                          </IconButton>
                        )}
                      />
                      <DeleteConfirmDialog
                        onConfirm={() => handleDeleteSchedule(row.id)}
                        trigger={(onClick) => (
                          <IconButton
                            color='error'
                            onClick={onClick}
                          >
                            <DeleteOutlineOutlined />
                          </IconButton>
                        )}
                      />
                    </Stack>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Box>
    </>
  )
}
