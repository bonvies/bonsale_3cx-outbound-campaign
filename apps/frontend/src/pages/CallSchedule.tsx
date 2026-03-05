import { useState, useMemo, useEffect, useCallback } from 'react'
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
import dayjs from 'dayjs'
import type { CallScheduleRecord, CallScheduleFilters as FilterType } from '../types/callSchedule'
import { CallScheduleDialog, type CallScheduleFormData } from '../components/CallSchedule/CallScheduleDialog'
import { CallScheduleFilters } from '../components/CallSchedule/CallScheduleFilters'
import { DeleteConfirmDialog } from '../components/CallSchedule/DeleteConfirmDialog'
import {
  fetchCallSchedules,
  createCallSchedule,
  updateCallSchedule,
  deleteCallSchedule,
} from '../api/CallSchedule'

const PAGE_SIZE = 10

export default function CallSchedule() {
  const [records, setRecords] = useState<CallScheduleRecord[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [filters, setFilters] = useState<FilterType>({
    startDate: null,
    endDate: null,
    status: ['全部'],
    search: '',
  })
  const [page, setPage] = useState(1)
  const [isSearchActive, setIsSearchActive] = useState(false)

  const doFetch = useCallback(async (opts: {
    page: number
    isSearchActive: boolean
    filters: FilterType
  }) => {
    try {
      const result = await fetchCallSchedules({ ...opts, pageSize: PAGE_SIZE })
      setRecords(result.data)
      setTotalCount(result.total)
    } catch (err) {
      console.error('Failed to fetch call schedules:', err)
    }
  }, [])

  useEffect(() => {
    doFetch({ page: 1, isSearchActive: false, filters })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSearch = () => {
    setIsSearchActive(true)
    setPage(1)
    doFetch({ page: 1, isSearchActive: true, filters })
  }

  const handleClearFilters = () => {
    const defaultFilters: FilterType = { startDate: null, endDate: null, status: ['全部'], search: '' }
    setFilters(defaultFilters)
    setIsSearchActive(false)
    setPage(1)
    doFetch({ page: 1, isSearchActive: false, filters: defaultFilters })
  }

  const handleRemoveFilter = (filterKey: keyof FilterType) => {
    const newFilters = { ...filters }
    if (filterKey === 'startDate' || filterKey === 'endDate') {
      newFilters[filterKey] = null
    } else if (filterKey === 'status') {
      newFilters.status = ['全部']
    } else if (filterKey === 'search') {
      newFilters.search = ''
    }
    setFilters(newFilters)
    setPage(1)
    doFetch({ page: 1, isSearchActive: true, filters: newFilters })
  }

  const handlePageChange = (_: React.ChangeEvent<unknown>, value: number) => {
    setPage(value)
    doFetch({ page: value, isSearchActive, filters })
  }

  const handleAddSchedule = async (data: CallScheduleFormData) => {
    try {
      await createCallSchedule(data)
      doFetch({ page, isSearchActive, filters })
    } catch (err) {
      console.error('Failed to create call schedule:', err)
    }
  }

  const handleEditSchedule = async (data: CallScheduleFormData) => {
    if (!data.id) return
    try {
      await updateCallSchedule(data.id, data)
      doFetch({ page, isSearchActive, filters })
    } catch (err) {
      console.error('Failed to update call schedule:', err)
    }
  }

  const handleDeleteSchedule = async (id: string) => {
    try {
      await deleteCallSchedule(id)
      doFetch({ page, isSearchActive, filters })
    } catch (err) {
      console.error('Failed to delete call schedule:', err)
    }
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  // 生成已套用的篩選條件 Chips
  const activeFilters = useMemo(() => {
    if (!isSearchActive) return []

    const chips: Array<{ key: keyof FilterType; label: string }> = []

    if (filters.startDate) {
      chips.push({
        key: 'startDate',
        label: `建立時間（起）: ${dayjs(filters.startDate).format('YYYY/MM/DD HH:mm')}`
      })
    }
    if (filters.endDate) {
      chips.push({
        key: 'endDate',
        label: `建立時間（訖）: ${dayjs(filters.endDate).format('YYYY/MM/DD HH:mm')}`
      })
    }
    if (!filters.status.includes('全部')) {
      chips.push({
        key: 'status',
        label: `撥號狀態: ${filters.status.join(', ')}`
      })
    }
    if (filters.search.trim()) {
      chips.push({
        key: 'search',
        label: `分機: ${filters.search}`
      })
    }

    return chips
  }, [filters, isSearchActive])

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
          onSubmit={handleAddSchedule}
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
          onClick={() => doFetch({ page, isSearchActive, filters })}
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
              page={page}
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
                  <TableCell align='center'>{row.date}</TableCell>
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
                        data={{
                          id: row.id,
                          extension: row.extension,
                          date: row.date,
                          retryInterval: row.retryInterval,
                          maxRetries: row.maxRetries ?? '3',
                          notificationContent: row.notificationContent,
                          audioFile: row.audioFile,
                          notes: row.notes || '',
                        }}
                        onSubmit={handleEditSchedule}
                        trigger={(onClick) => (
                          <IconButton onClick={onClick}>
                            <Edit />
                          </IconButton>
                        )}
                      />
                      <CallScheduleDialog
                        mode="info"
                        data={{
                          id: row.id,
                          extension: row.extension,
                          date: row.date,
                          retryInterval: row.retryInterval,
                          maxRetries: row.maxRetries ?? '3',
                          notificationContent: row.notificationContent,
                          audioFile: row.audioFile,
                          notes: row.notes || '',
                        }}
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
