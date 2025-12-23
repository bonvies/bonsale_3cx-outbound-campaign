import { useState, useMemo, useEffect } from 'react'
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
  CircularProgress,
  Alert,
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
import * as callScheduleApi from '../services/callScheduleApi'

const PAGE_SIZE = 10

export default function CallSchedule() {
  const [dataList, setDataList] = useState<CallScheduleRecord[]>([])
  const [filters, setFilters] = useState<FilterType>({
    startDate: null,
    endDate: null,
    status: ['全部'],
    search: '',
  })
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 取得資料
  const fetchData = async () => {
    setLoading(true)
    setError(null)

    try {
      const queryParams: callScheduleApi.CallScheduleQueryParams = {
        page,
        limit: PAGE_SIZE,
        sortBy: 'date',
        sortOrder: 'DESC',
      }

      // 過濾條件
      if (filters.startDate) {
        queryParams.dateFrom = dayjs(filters.startDate).toISOString()
      }
      if (filters.endDate) {
        queryParams.dateTo = dayjs(filters.endDate).toISOString()
      }
      if (!filters.status.includes('全部') && filters.status.length > 0) {
        // 轉換中文狀態為英文
        const englishStatus = callScheduleApi.reverseStatusMap[filters.status[0]]
        if (englishStatus) {
          queryParams.callStatus = englishStatus
        }
      }
      if (filters.search.trim()) {
        queryParams.search = filters.search
      }

      const result = await callScheduleApi.getCallSchedules(queryParams)
      setDataList(result.data)
      setTotalPages(result.pagination.totalPages)
      setTotalRecords(result.pagination.total)
    } catch (err) {
      console.error('Failed to fetch call schedules:', err)
      setError('載入資料失敗，請稍後再試')
    } finally {
      setLoading(false)
    }
  }

  // 初始載入和篩選條件變更時重新載入
  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filters])

  const handleClearFilters = () => {
    setFilters({
      startDate: null,
      endDate: null,
      status: ['全部'],
      search: '',
    })
    setPage(1)
  }

  const handleSearch = () => {
    setPage(1)
  }

  const handleRemoveFilter = (filterKey: keyof FilterType) => {
    setFilters(prev => {
      const newFilters = { ...prev }
      if (filterKey === 'startDate' || filterKey === 'endDate') {
        newFilters[filterKey] = null
      } else if (filterKey === 'status') {
        newFilters[filterKey] = ['全部']
      } else if (filterKey === 'search') {
        newFilters[filterKey] = ''
      }
      return newFilters
    })
  }

  // 生成已套用的篩選條件 Chips
  const activeFilters = useMemo(() => {
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
  }, [filters])

  const handleAddSchedule = async (data: CallScheduleFormData) => {
    try {
      setLoading(true)
      const createData: callScheduleApi.CreateCallScheduleDto = {
        audioFile: data.audioFile,
        date: dayjs(data.date, 'YYYY/MM/DD HH:mm').toISOString(),
        extension: data.extension,
        notificationContent: data.notificationContent,
        retryInterval: parseInt(data.retryInterval),
        notes: data.notes,
      }
      await callScheduleApi.createCallSchedule(createData)
      await fetchData() // 重新載入資料
    } catch (err) {
      console.error('Failed to create schedule:', err)
      setError('新增失敗，請稍後再試')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteSchedule = async (id: string) => {
    try {
      setLoading(true)
      await callScheduleApi.deleteCallSchedule(id)
      await fetchData() // 重新載入資料
    } catch (err) {
      console.error('Failed to delete schedule:', err)
      setError('刪除失敗，請稍後再試')
    } finally {
      setLoading(false)
    }
  }

  const handleEditSchedule = async (id: string, data: CallScheduleFormData) => {
    try {
      setLoading(true)
      const updateData: callScheduleApi.UpdateCallScheduleDto = {
        audioFile: data.audioFile,
        date: dayjs(data.date, 'YYYY/MM/DD HH:mm').toISOString(),
        extension: data.extension,
        callStatus: callScheduleApi.reverseStatusMap['排程中'], // 編輯時預設為排程中
        notificationContent: data.notificationContent,
        retryInterval: parseInt(data.retryInterval),
        notes: data.notes,
      }
      await callScheduleApi.updateCallSchedule(id, updateData)
      await fetchData() // 重新載入資料
    } catch (err) {
      console.error('Failed to update schedule:', err)
      setError('更新失敗，請稍後再試')
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case '排程中':
        return 'warning'
      case '已完成':
        return 'success'
      case '失敗':
        return 'error'
      default:
        return 'default'
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
          onClick={fetchData}
          disabled={loading}
        >
          <Refresh />
        </IconButton>

        <Box sx={{ ml: 'auto' }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              共 {totalRecords} 筆
            </Typography>
            <Pagination
              count={totalPages}
              page={page}
              onChange={(_, value) => setPage(value)}
              size="small"
              color="primary"
            />
          </Stack>
        </Box>
      </Stack>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Table */}
      <Box
        sx={{
          height: '100%',
          maxHeight:'100%',
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
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ height: '100%', borderBottom: 'none', py: 8 }}>
                  <CircularProgress />
                </TableCell>
              </TableRow>
            ) : dataList.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ height: '100%', borderBottom: 'none', color: '#888', py: 4, fontSize: '1.5rem' }}>
                  沒有資料
                </TableCell>
              </TableRow>
            ) : (
              dataList.map((row) => (
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
                          extension: row.extension,
                          date: row.date,
                          retryInterval: row.retryInterval,
                          maxRetries: '3',
                          notificationContent: row.notificationContent,
                          audioFile: row.audioFile,
                          notes: row.notes || '',
                        }}
                        onSubmit={(data) => handleEditSchedule(row.id, data)}
                        trigger={(onClick) => (
                          <IconButton onClick={onClick}>
                            <Edit/>
                          </IconButton>
                        )}
                      />
                      <CallScheduleDialog
                        mode="info"
                        data={{
                          extension: row.extension,
                          date: row.date,
                          retryInterval: row.retryInterval,
                          maxRetries: '3',
                          notificationContent: row.notificationContent,
                          audioFile: row.audioFile,
                          notes: row.notes || '',
                        }}
                        trigger={(onClick) => (
                          <IconButton onClick={onClick}>
                            <InfoOutlined/>
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
                            <DeleteOutlineOutlined/>
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
