import { useState, useMemo } from 'react'
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

// 模擬數據
const testData: CallScheduleRecord[] = [
  {
    id: '1',
    audioFile: '預設鈴聲',
    date: '2025/12/05 07:30',
    extension: 'A館 10F - 1002',
    callStatus: '排程中',
    callRecord: '-',
    notes: '',
    notificationContent: '標準叫醒服務',
    retryInterval: '5',
  },
  {
    id: '2',
    audioFile: '預設鈴聲',
    date: '2025/12/05 06:30',
    extension: 'B館 11F - 1108',
    callStatus: '排程中',
    callRecord: '-',
    notes: '明天會議叫醒',
    notificationContent: '標準叫醒服務',
    retryInterval: '5',
  },
  {
    id: '3',
    date: '2025/12/04 06:30',
    extension: 'B館 11F - 1108',
    callStatus: '排程中',
    callRecord: '-',
    notes: '',
    notificationContent: '標準叫醒服務',
    retryInterval: '5',
    audioFile: '預設鈴聲'
  },
  {
    id: '4',
    date: '2025/12/04 06:00',
    extension: 'B館 11F - 1101',
    callStatus: '已完成',
    callRecord: '已接聽',
    notes: '',
    notificationContent: '標準叫醒服務',
    retryInterval: '5',
    audioFile: '預設鈴聲'
  },
  {
    id: '5',
    date: '2025/12/03 07:15',
    extension: 'B館 11F - 1108',
    callStatus: '排程中',
    callRecord: '-',
    notes: '',
    notificationContent: '標準叫醒服務',
    retryInterval: '5',
    audioFile: '預設鈴聲'
  },
  {
    id: '6',
    date: '2025/12/03 06:45',
    extension: 'B館 11F - 1103',
    callStatus: '失敗',
    callRecord: '未接聽',
    notes: '',
    notificationContent: '標準叫醒服務',
    retryInterval: '5',
    audioFile: '預設鈴聲'
  },
  {
    id: '7',
    date: '2025/12/03 06:30',
    extension: 'B館 11F - 1108',
    callStatus: '排程中',
    callRecord: '-',
    notes: '',
    notificationContent: '標準叫醒服務',
    retryInterval: '5',
    audioFile: '預設鈴聲'
  },
  {
    id: '8',
    date: '2025/12/03 06:00',
    extension: 'B館 11F - 1108',
    callStatus: '已完成',
    callRecord: '已接聽',
    notes: '提醒飛機起飛時間',
    notificationContent: '標準叫醒服務',
    retryInterval: '5',
    audioFile: '預設鈴聲'
  },
  {
    id: '9',
    date: '2025/12/03 05:30',
    extension: 'C館 12F - 1201',
    callStatus: '已完成',
    callRecord: '已接聽 — 車呼成功',
    notes: '',
    notificationContent: '標準叫醒服務',
    retryInterval: '5',
    audioFile: '預設鈴聲'
  },
  {
    id: '10',
    date: '2025/12/02 09:00',
    extension: 'B館 11F - 1108',
    callStatus: '失敗',
    callRecord: '系統錯誤，無法完成撥號',
    notes: '',
    notificationContent: '標準叫醒服務',
    retryInterval: '5',
    audioFile: '預設鈴聲'
  },
]

const PAGE_SIZE = 10

export default function CallSchedule() {
  const [mockList, setMockList] = useState(testData)
  const [filters, setFilters] = useState<FilterType>({
    startDate: null,
    endDate: null,
    status: ['全部'],
    search: '',
  })
  const [page, setPage] = useState(1)
  const [isSearchActive, setIsSearchActive] = useState(false)

  // 過濾資料
  const filteredList = useMemo(() => {
    if (!isSearchActive) {
      return mockList
    }

    let result = mockList

    // 過濾時間區間
    if (filters.startDate) {
      result = result.filter(item => {
        const itemDate = dayjs(item.date, 'YYYY/MM/DD HH:mm')
        return itemDate.isAfter(dayjs(filters.startDate)) || itemDate.isSame(dayjs(filters.startDate))
      })
    }
    if (filters.endDate) {
      result = result.filter(item => {
        const itemDate = dayjs(item.date, 'YYYY/MM/DD HH:mm')
        return itemDate.isBefore(dayjs(filters.endDate)) || itemDate.isSame(dayjs(filters.endDate))
      })
    }

    // 過濾狀態
    if (!filters.status.includes('全部')) {
      result = result.filter(item => filters.status.includes(item.callStatus))
    }

    // 過濾分機號
    if (filters.search.trim()) {
      result = result.filter(item =>
        item.extension.toLowerCase().includes(filters.search.toLowerCase())
      )
    }

    return result
  }, [mockList, filters, isSearchActive])

  // 計算過濾後的總頁數
  const totalPages = useMemo(() => {
    return Math.ceil(filteredList.length / PAGE_SIZE)
  }, [filteredList.length])

  // 計算當前頁面應該顯示的數據
  const paginatedList = useMemo(() => {
    return filteredList.slice(
      (page - 1) * PAGE_SIZE,
      page * PAGE_SIZE
    )
  }, [filteredList, page])

  const handleClearFilters = () => {
    setFilters({
      startDate: null,
      endDate: null,
      status: ['全部'],
      search: '',
    })
    setIsSearchActive(false)
    setPage(1)
  }

  const handleSearch = () => {
    setIsSearchActive(true)
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

  const handleAddSchedule = (data: CallScheduleFormData) => {
    console.log('新增排程通話:', data)
    const newRecord: CallScheduleRecord = {
      id: (mockList.length + 1).toString(),
      audioFile: data.audioFile,
      date: data.date,
      extension: data.extension,
      callStatus: '排程中',
      callRecord: '-',
      notes: data.notes,
      notificationContent: data.notificationContent,
      retryInterval: data.retryInterval,
    }
    setMockList([newRecord, ...mockList])
  }

  const handleDeleteSchedule = (id: string) => {
    console.log('刪除排程通話:', id)
    setMockList(mockList.filter((item) => item.id !== id))
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
        >
          <Refresh />
        </IconButton>

        <Box sx={{ ml: 'auto' }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              共 {filteredList.length} 筆
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
            {paginatedList.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ height: '100%', borderBottom: 'none', color: '#888', py: 4, fontSize: '1.5rem' }}>
                  沒有資料
                </TableCell>
              </TableRow>
            ) : (
              paginatedList.map((row) => (
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
                        onSubmit={handleAddSchedule}
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
