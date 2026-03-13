// import InfoOutlineIcon from '@mui/icons-material/InfoOutline';
// import { useNavigate } from 'react-router-dom'
import { Fragment, useRef, useState, useEffect, useMemo } from 'react';
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Stack,
  Box,
  Switch,
  Button,
  LinearProgress,
  Alert,
  CircularProgress,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import InfoOutlineIcon from '@mui/icons-material/InfoOutline';

import GlobalSnackbar, { type GlobalSnackbarRef } from '../../../shared/components/GlobalSnackbar';
import ProjectCustomersDialog from '../components/ProjectCustomersDialog';

import useProjectOutboundData from '../hooks/useProjectOutboundData';
import useConnectBonsaleWebHookWebSocket from '../hooks/useConnectBonsaleWebHookWebSocket';

import useUpdateBonsaleProject from '../hooks/api/useUpdateBonsaleProject';

const VITE_ENV = import.meta.env.VITE_ENV;
export default function OutboundCampaign() {
  // WebSocket 狀態
  const [wsStatus, setWsStatus] = useState<'connecting'|'open'|'closed'|'error'>('connecting');
  const [wsMessage, setWsMessage] = useState<string>('');
  const wsRef = useRef<WebSocket | null>(null);
  
  // 開始外撥按鈕 loading 狀態 (以 projectId 為 key)
  const [startOutboundLoading, setStartOutboundLoading] = useState<Set<string>>(new Set());
  
  // 停止外撥按鈕 loading 狀態 (以 projectId 為 key)
  const [stopOutboundLoading, setStopOutboundLoading] = useState<Set<string>>(new Set());

  // 發送 WS 訊息
  const sendMessage = (message: SendMessagePayload<SendProjectMessage>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket is not open or message is empty');
    }
  };

  // 取得本機 IP domain
  const { hostname } = window.location;
  // 連線 WebSocket
  const WS_PROTOCOL = import.meta.env.VITE_WS_PROTOCOL;
  const DOMAIN = import.meta.env.VITE_DOMAIN;
  const PORT = import.meta.env.VITE_API_PORT;
  const WS_URL = DOMAIN === 'localhost' ? `${WS_PROTOCOL}://${hostname}:${PORT}` : `${WS_PROTOCOL}://${DOMAIN}:${PORT}`;

  // 只在元件掛載時執行一次
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    setWsStatus('connecting');
    
    // 設定前端心跳機制
    let heartbeatInterval: NodeJS.Timeout;
    
    const startHeartbeat = () => {
      // 每55秒發送一次 ping 到後端（比後端的60秒稍短）
      heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ event: 'ping', timestamp: Date.now() }));
          console.log('💓 發送前端 ping');
        }
      }, 55000);
    };

    ws.onopen = () => {
      setWsStatus('open');
      console.log('WebSocket 連線成功');
      // 連線成功後開始心跳
      startHeartbeat();
    };
    
    ws.onmessage = (event) => {
      console.log('📣 收到 WebSocket 訊息:', JSON.parse(event.data));
      // 處理後端的 pong 回應
      try {
        const message = JSON.parse(event.data);
        switch (message.event) {
          case 'pong':
            // console.log('💚 收到後端 pong 回應');
            break;
          case 'allProjects':
            // console.log('📋 收到所有專案訊息:', message.payload);
            setWsMessage(event.data);
            break;
          case 'stopOutbound':
            console.log('🛑 收到停止外撥訊息:', message.payload);
            setWsMessage(event.data);
            break;
          case 'error':
            console.error('🛑 收到錯誤訊息:', message.payload);
            // 顯示錯誤訊息到 Snackbar
            snackbarRef.current?.showSnackbar(
              message.payload?.error?.message || '發生未知錯誤',
              'error'
            );
            break;
          default:
            console.warn('未知的 WebSocket 訊息事件:', message.event);
        }
      } catch (error) {
        // 如果不是 JSON 格式，忽略解析錯誤
        console.log('JSON 解析失敗:', error);
      }
    };
    
    ws.onerror = (error) => {
      setWsStatus('error');
      console.error('WebSocket 錯誤:', error);
      // 清理心跳定時器
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
    };
    
    ws.onclose = () => {
      setWsStatus('closed');
      console.log('WebSocket 連線關閉');
      // 清理心跳定時器
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
    };

    return () => {
      // 清理心跳定時器
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      ws.close();
    };
  }, [WS_URL]);

  // 引入 自定義 API Hook
  const { updateProject } = useUpdateBonsaleProject();
  
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null); // 用於跟踪當前展開的專案 ID

  const handleExpandClick = (isOpen: boolean, projectId?: string) => {
    if (isOpen && projectId) {
      setExpandedProjectId(projectId);
    } else {
      setExpandedProjectId(null);
    }
  }

  const snackbarRef = useRef<GlobalSnackbarRef>(null);

  const { projectOutboundData, setProjectOutboundData, isLoading: projectOutboundDataIsloading, loadMore, hasMore  } = useProjectOutboundData();
  
  // 使用 Bonsale WebHook WebSocket hook
  const { isConnected: bonsaleWebHookConnected, disconnect: disconnectBonsaleWebHook } = useConnectBonsaleWebHookWebSocket({ setProjectOutboundData });
  
  const tableBoxRef = useRef<HTMLDivElement>(null);

  // 滾動到底自動加載
  const handleScroll = () => {
    const box = tableBoxRef.current;
    if (!box || !hasMore) return;
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 10) { // 10px buffer
      loadMore();
    }
  };

  // 解析 WebSocket 訊息
  const parsedWsMessage = useMemo((): WebSocketMessage | null => {
    if (!wsMessage) return null;
    try {
      return JSON.parse(wsMessage);
    } catch (error) {
      console.error('解析 WebSocket 訊息失敗:', error);
      return null;
    }
  }, [wsMessage]);

  // 處理專案通話訊息的映射
  const projectCallMessageMap = useMemo(() => {
    if (!parsedWsMessage?.payload?.allProjects) return new Map<string, WebSocketProject>();
    
    const map = new Map<string, WebSocketProject>();
    parsedWsMessage.payload.allProjects.forEach((project: WebSocketProject) => {
      map.set(project.projectId, project);
    });
    return map;
  }, [parsedWsMessage]);

  // 根據專案 ID 獲取通話訊息
  const getProjectCallMessage = (projectId: string): WebSocketProject | undefined => {
    return projectCallMessageMap.get(projectId);
  };

  // 監聽 WebSocket 訊息變化，檢查是否需要結束 loading
  useEffect(() => {
    if (!parsedWsMessage?.payload?.allProjects) return;

    // 檢查每個正在 loading 的按鈕
    // 處理開始撥打 loading
    setStartOutboundLoading(prev => {
      const newSet = new Set(prev);
      let hasChange = false;

      prev.forEach(projectId => {
        const projectWsData = projectCallMessageMap.get(projectId);
        // 如果收到了該專案的回應(有 WebSocket 資料)，則結束開始 loading
        if (projectWsData) {
          newSet.delete(projectId);
          hasChange = true;
        }
      });

      return hasChange ? newSet : prev;
    });

    // 處理停止撥打 loading
    setStopOutboundLoading(prev => {
      const newSet = new Set(prev);
      let hasChange = false;

      prev.forEach(projectId => {
        const projectWsData = projectCallMessageMap.get(projectId);
        // 如果狀態是 'stop' 且沒有當前撥打資訊，則結束 loading
        if (projectWsData?.state === 'stop' && 
            (!projectWsData.latestCallRecord || projectWsData.latestCallRecord.length === 0)) {
          newSet.delete(projectId);
          hasChange = true;
        }
      });

      return hasChange ? newSet : prev;
    });
  }, [parsedWsMessage, projectCallMessageMap]);
 
  // 開始撥打電話
  const handleStartOutbound = (project: ProjectOutboundDataType) => {
    // 如果已經在 loading 中，直接返回
    if (startOutboundLoading.has(project.projectId)) {
      return;
    }

    // 設置 loading 狀態
    setStartOutboundLoading(prev => new Set(prev).add(project.projectId));

    const message = {
      event: 'startOutbound',
      payload: {
        project: {
          callFlowId: project.callFlowId || '',
          client_id: project.appId || '',
          client_secret: project.appSecret || '',
          projectId: project.projectId || '',
          recurrence: project.recurrence || null, // 確保不是 undefined
          callRestriction: project.callRestriction || []
        }
      }
    }

    sendMessage(message);

    // 5 秒超時機制：如果後端沒有回應，強制移除 loading 狀態
    setTimeout(() => {
      setStartOutboundLoading(prev => {
        if (prev.has(project.projectId)) {
          console.warn(`⚠️ 開始外撥超時，強制移除 loading 狀態: ${project.projectId}`);
          const newSet = new Set(prev);
          newSet.delete(project.projectId);
          return newSet;
        }
        return prev;
      });
    }, 5000);
  };

  // 暫停撥打電話
  // const handlePauseOutbound = () => {

  // };

  // 停止撥打電話
  const handleStopOutbound = (project: ProjectOutboundDataType) => {
    // 如果已經在 loading 中，直接返回
    if (stopOutboundLoading.has(project.projectId)) {
      return;
    }

    // 設置 loading 狀態
    setStopOutboundLoading(prev => new Set(prev).add(project.projectId));

    const message = {
      event: 'stopOutbound',
      payload: {
        project: {
          callFlowId: project.callFlowId,
          client_id: project.appId,
          client_secret: project.appSecret,
          projectId: project.projectId,
          state: 'active',
          error: null
        }
      }
    }

    sendMessage(message);

    // 5 秒超時機制：如果後端沒有回應，強制移除 loading 狀態
    setTimeout(() => {
      setStopOutboundLoading(prev => {
        if (prev.has(project.projectId)) {
          console.warn(`⚠️ 停止外撥超時，強制移除 loading 狀態: ${project.projectId}`);
          const newSet = new Set(prev);
          newSet.delete(project.projectId);
          return newSet;
        }
        return prev;
      });
    }, 5000);
  };

  // 全部專案開始外撥
  const handleAllProjectStartOutbound = async () => {
    for (const project of projectOutboundData) {
      handleStartOutbound(project);
    }
  }

  // 切換專案啟用狀態
  const handleToggleProject = async (project: ProjectOutboundDataType) => {
    const { projectId, isEnable } = project;
    await updateProject(projectId, JSON.stringify(!isEnable))
    setProjectOutboundData(prev => 
      prev.map(item => {
        if (item.projectId === projectId) {
          (async () => {
            try {
              setProjectOutboundData(prevInner =>
                prevInner.map(innerItem =>
                  innerItem.projectId === projectId
                    ? { ...innerItem, isEnable: !isEnable }
                    : innerItem
                )
              );
            } catch (error) {
              console.error('Error fetching project customers:', error);
            }
          })();
          return { ...item, isEnable: !isEnable }; // 先切換 isEnable，projectCustomersDesc 由上面 async 處理
        }
        return item;
      })
    );
  };
    
  return (
    <>
      {/* WebSocket 狀態顯示 */}
      {VITE_ENV === 'development' && (
        <>
          <Alert 
            severity={wsStatus === 'open' ? 'success' : wsStatus === 'closed' ? 'error' : 'info'}
            sx={{ mb: 1 }}
          >
            主要 WebSocket 狀態：{wsStatus.length > 20 ? `${wsStatus.substring(0, 20)}...` : wsStatus}
            {wsMessage && (
              <Box sx={{ mt: 1 }}>
                收到訊息：{wsMessage.length > 300 ? `${wsMessage.substring(0, 300)}...` : wsMessage}
              </Box>
            )}
            {wsStatus === 'open' && (
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                
                {/* <Button size="small" variant="contained" onClick={() => sendMessage('測試訊息發送')}>
                  測試訊息發送
                </Button> */}
              </Stack>
            )}
          </Alert>
          
          <Alert 
            severity={bonsaleWebHookConnected ? 'success' : 'warning'}
            sx={{ mb: 2 }}
          >
            📡 Bonsale WebHook 狀態：{bonsaleWebHookConnected ? '已連接' : '未連接'}
            {bonsaleWebHookConnected && (
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Button 
                  size="small" 
                  variant="outlined" 
                  onClick={disconnectBonsaleWebHook}
                  color="warning"
                >
                  中斷 WebHook 連接
                </Button>
              </Stack>
            )}
          </Alert>
        </>
      )}
      <GlobalSnackbar ref={snackbarRef} />
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
        <Stack spacing={1}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Button 
              variant="contained" 
              onClick={() => handleAllProjectStartOutbound()}
              sx={{
                margin: '12px 0',
                minWidth: '100px',
                bgcolor: (theme) => theme.palette.secondary.main, 
              }}
            >
              全部執行
            </Button> 
          </Stack>
        </Stack>
      </Stack>
      <Box 
        ref={tableBoxRef}
        sx={{ height: '100%', maxHeight:'100%', overflowY: 'scroll' }}
        onScroll={handleScroll}
      >
        <Table stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell align='center' sx={{ width: '20px' }}>
                啟用專案
              </TableCell>
              <TableCell align='center' sx={{ width: '120px' }}>
                專案名稱
              </TableCell>
              <TableCell align='center' sx={{ width: '20px' }}>
                狀態
              </TableCell>
              <TableCell align='center' sx={{ width: '20px' }}>
                分機
              </TableCell>
              <TableCell align='center' sx={{ width: '30px' }}>
                <Stack direction='row' alignItems='center' justifyContent='center'>
                  動作 
                </Stack>
              </TableCell>
              <TableCell align='center' sx={{ width: '400px' }}>
                當前撥打資訊
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody sx={{  backgroundColor: 'white' }}>
            {
              projectOutboundDataIsloading ?
                <TableRow>
                  <TableCell colSpan={8} sx={{ padding: 0 }}>
                    <LinearProgress />
                  </TableCell>
                </TableRow>
              : projectOutboundData.length == 0 &&
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ height: '100%', borderBottom: 'none' , color: '#888', py: 4, fontSize: '1.5rem' }}>
                    沒有名單
                  </TableCell>
                </TableRow>
            }
            {projectOutboundData.map((item, index) => {
              const projectWsData = getProjectCallMessage(item.projectId);
              const projectWsDataState = projectWsData?.state;
              const stateLabel = projectWsData
                ? projectWsDataState === 'active'
                  ? '執行中'
                  : projectWsDataState === 'stop'
                  ? '停止撥打'
                  : projectWsDataState
                : '未執行';
              const stateColor = projectWsData
                ? projectWsDataState === 'active'
                  ? 'success.main'
                  : projectWsDataState === 'stop'
                  ? 'warning.main'
                  : 'primary.color50'
                : 'primary.color50';
              return (
                <Fragment key={item.projectId + index}>
                  <TableRow 
                    key={item.projectId}
                    sx={{

                      minHeight: '120px',
                      '& .MuiTableCell-root': {
                        verticalAlign: 'top',
                        paddingY: '16px'
                      },
                      transition: 'all 0.3s ease-in-out'
                    }}
                  >
                    <TableCell>
                      <Switch 
                        checked={item.isEnable}
                        onChange={() => handleToggleProject(item)}
                      />
                    </TableCell>
                    <TableCell align='center'>
                      {item.projectName}
                    </TableCell>
                    <TableCell align='center'>
                      {!projectWsData ? (
                        <Chip label="未執行" sx={{ bgcolor: 'primary.color50' }} />
                      ) : (
                        <Chip label={stateLabel} sx={{ bgcolor: stateColor, color: 'white' }} />
                      )}
                    </TableCell>
                    <TableCell align='center'>
                      {item.extension}
                    </TableCell>
                    <TableCell align='center'>
                      <Stack direction='row'>
                        {item.isEnable ? 
                          !projectWsData ? 
                            <IconButton 
                              onClick={() => handleStartOutbound(item)}
                              color="success"
                              title="開始外撥"
                              disabled={startOutboundLoading.has(item.projectId)}
                            >
                              {startOutboundLoading.has(item.projectId) ? (
                                <CircularProgress size={20} color="inherit" />
                              ) : (
                                <PlayArrowIcon />
                              )}
                            </IconButton> : 
                                <IconButton 
                                  onClick={() => handleStopOutbound(item)}
                                  color="error"
                                  title="停止外撥"
                                  disabled={stopOutboundLoading.has(item.projectId) ||
                                    projectWsDataState === 'stop'
                                   }
                                >
                                  {stopOutboundLoading.has(item.projectId) ? (
                                    <CircularProgress size={20} color="inherit" />
                                  ) : (
                                    <StopIcon />
                                  )}
                                </IconButton> 
                          : null} 
                        <IconButton 
                          onClick={() => handleExpandClick(true, item.projectId)}
                          title="查看詳細"
                        >
                          <InfoOutlineIcon /> 
                        </IconButton> 
                      </Stack>
                    </TableCell>
                    <TableCell align='left'>
                      {!projectWsData?.caller || projectWsData.caller.length === 0 ? (
                        <Chip label="無分機資料" variant="outlined" size="small" />
                      ): <Stack spacing={2}>
                        {projectWsData && projectWsData.caller.map((caller, callerIndex) => (
                          <Box 
                            key={`${caller.dn}-${callerIndex}`}
                            sx={{
                              border: '1px solid #e0e0e0',
                              borderRadius: '8px',
                              padding: '12px',
                              backgroundColor: '#fafafa'
                            }}
                          >
                            {/* 分機標題 */}
                            <Stack direction="row" spacing={1} sx={{ marginBottom: '8px' }}>
                              <Chip
                                label={`分機 ${caller.dn}`}
                                variant="filled"
                                size="small"
                                sx={{ 
                                  fontWeight: 'bold',
                                  bgcolor: (theme) => theme.palette.primary.main,
                                  color: 'white'
                                }}
                              />
                              {caller.devices?.map((device, deviceIndex) => (
                                <Chip
                                  key={`device-${deviceIndex}`}
                                  label={`Device: ${device.dn}`}
                                  variant="outlined"
                                  size="small"
                                  sx={{ fontSize: '0.7rem' }}
                                />
                              ))}
                            </Stack>

                            {/* 通話狀態 */}
                            {caller.participants?.length > 0 ? (
                              <Stack spacing={1}>
                                <Box sx={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#666' }}>
                                  通話中：
                                </Box>
                                {caller.participants.map((participant, participantIndex) => (
                                  <Box 
                                    key={`participant-${participantIndex}`}
                                    sx={{
                                      backgroundColor: 'white',
                                      padding: '8px',
                                      borderRadius: '4px',
                                      border: '1px solid #ddd'
                                    }}
                                  >
                                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: '4px' }}>
                                      <Chip
                                        label={`狀態: ${participant.status}`}
                                        size="small"
                                        sx={{ 
                                          bgcolor: (theme) => 
                                            participant.status === 'Dialing' ? theme.palette.warning.main :
                                            participant.status === 'Connected' ? theme.palette.success.main :
                                            theme.palette.primary.main,
                                          color: 'white',
                                          fontWeight: 'bold'
                                        }}
                                      />
                                      <Stack direction="row" spacing={1}>
                                        {participant.party_caller_id && (
                                          <Chip
                                            label={`來電號碼: ${participant.party_caller_id}`}
                                            variant="outlined"
                                            size="small"
                                          />
                                        )}
                                        {participant.party_dn && (
                                          <Chip
                                            label={`分機: ${participant.party_dn}`}
                                            variant="outlined"
                                            size="small"
                                          />
                                        )}
                                      </Stack>
                                      <Chip
                                        label={`Call ID: ${participant.callid}`}
                                        variant="outlined"
                                        size="small"
                                        sx={{ fontSize: '0.7rem' }}
                                      />
                                    </Stack>
                                    {/* 🆕 顯示分機最後執行時間 */}
                                    {projectWsData.callerExtensionLastExecutionTime && projectWsData.callerExtensionLastExecutionTime[caller.dn] && (
                                      <Box sx={{ fontSize: '0.75rem', color: '#666' }}>
                                        最後執行: {new Date(projectWsData.callerExtensionLastExecutionTime[caller.dn]).toLocaleTimeString('zh-TW')}
                                      </Box>
                                    )}
                                  </Box>
                                ))}
                              </Stack>
                            ) : (
                              <>
                                <Stack spacing={1} sx={{ alignItems: 'center' }}>
                                  <Chip
                                    label="分機空閒"
                                    size="small"
                                    sx={{
                                      bgcolor: (theme) => theme.palette.success.color300,
                                      color: 'white',
                                      fontWeight: 'bold'
                                    }}
                                  />
                                </Stack>
                                {/* 🆕 顯示分機最後執行時間 */}
                                {projectWsData.callerExtensionLastExecutionTime && projectWsData.callerExtensionLastExecutionTime[caller.dn] && (
                                  <Box sx={{ fontSize: '0.75rem', color: '#666' }}>
                                    最後執行: {new Date(projectWsData.callerExtensionLastExecutionTime[caller.dn]).toLocaleTimeString('zh-TW')}
                                  </Box>
                                )}
                              </>
                            )}
                          </Box>
                        ))}
                        
                        {/* 當前撥打記錄 */}
                        {projectWsData && projectWsData.latestCallRecord && projectWsData.latestCallRecord.length > 0 && (
                          <Box 
                            sx={{ 
                              marginTop: '12px', 
                              padding: '12px', 
                              backgroundColor: '#f3e5f5', 
                              borderRadius: '8px',
                              border: '1px solid #9c27b0'
                            }}
                          >
                            <Box sx={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#666', marginBottom: '8px' }}>
                              📞 當前撥打記錄：
                            </Box>
                            <Stack spacing={1}>
                              {projectWsData.latestCallRecord.map((callRecord, callIndex) => (
                                <Box 
                                  key={`call-${callIndex}`}
                                  sx={{
                                    backgroundColor: 'white',
                                    padding: '8px',
                                    borderRadius: '4px',
                                    border: '1px solid #ddd'
                                  }}
                                >
                                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                                    <Chip
                                      label={`分機: ${callRecord.dn}`}
                                      size="small"
                                      sx={{ 
                                        bgcolor: (theme) => theme.palette.primary.main,
                                        color: 'white',
                                        fontWeight: 'bold'
                                      }}
                                    />
                                    <Chip
                                      label={`狀態: ${callRecord.status}`}
                                      size="small"
                                      sx={{ 
                                        bgcolor: (theme) => 
                                          callRecord.status === 'Dialing' ? theme.palette.warning.main :
                                          callRecord.status === 'Connected' ? theme.palette.success.main :
                                          theme.palette.grey[500],
                                        color: 'white',
                                        fontWeight: 'bold'
                                      }}
                                    />
                                    <Chip
                                      label={`客戶: ${callRecord.memberName}`}
                                      variant="outlined"
                                      size="small"
                                      sx={{ fontWeight: 'bold' }}
                                    />
                                    <Chip
                                      label={`電話: ${callRecord.phone}`}
                                      variant="outlined"
                                      size="small"
                                    />
                                    {callRecord.dialTime && (
                                      <Chip
                                        label={`撥打時間: ${new Date(callRecord.dialTime).toLocaleString('zh-TW', {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                          second: '2-digit'
                                        })}`}
                                        variant="outlined"
                                        size="small"
                                        sx={{ fontSize: '0.7rem', color: '#666' }}
                                      />
                                    )}
                                  </Stack>
                                </Box>
                              ))}
                            </Stack>
                          </Box>
                        )}

                        {/* 專案統計資訊 */}
                        <Box 
                          sx={{ 
                            marginTop: '12px', 
                            padding: '8px', 
                            backgroundColor: '#e3f2fd', 
                            borderRadius: '6px',
                            border: '1px solid #2196f3'
                          }}
                        >
                          <Stack direction="row" spacing={1} sx={{ justifyContent: 'center' }}>
                            <Chip
                              label={`分機數: ${projectWsData?.agentQuantity ?? ''}`}
                              variant="outlined"
                              size="small"
                              sx={{ fontSize: '0.7rem' }}
                            />
                            {projectWsData && projectWsData.latestCallRecord && (
                              <Chip
                                label={`當前撥打: ${projectWsData.latestCallRecord.length} 通`}
                                variant="outlined"
                                size="small"
                                sx={{ fontSize: '0.7rem', color: '#9c27b0' }}
                              />
                            )}
                          </Stack>
                          {/* 專案資訊顯示 */}
                          {projectWsData && projectWsData.info && (
                            <Box 
                              sx={{ 
                                marginTop: '12px'
                              }}
                            >
                              <Alert 
                                severity="info" 
                                sx={{ 
                                  fontSize: '0.8rem',
                                  '& .MuiAlert-message': {
                                    wordBreak: 'break-word'
                                  }
                                }}
                              >
                                <strong>專案資訊：</strong>{projectWsData.info}
                              </Alert>
                            </Box>
                          )}
                          {/* 專案警告顯示 */}
                          {projectWsData && projectWsData.warning && (
                            <Box 
                              sx={{ 
                                marginTop: '12px'
                              }}
                            >
                              <Alert 
                                severity="warning" 
                                sx={{ 
                                  fontSize: '0.8rem',
                                  '& .MuiAlert-message': {
                                    wordBreak: 'break-word'
                                  }
                                }}
                              >
                                <strong>專案警告：</strong>{projectWsData.warning}
                              </Alert>
                            </Box>
                          )}
                          {/* 專案錯誤顯示 */}
                          {projectWsData && projectWsData.error && (
                            <Box 
                              sx={{ 
                                marginTop: '12px'
                              }}
                            >
                              <Alert 
                                severity="error" 
                                sx={{ 
                                  fontSize: '0.8rem',
                                  '& .MuiAlert-message': {
                                    wordBreak: 'break-word'
                                  }
                                }}
                              >
                                <strong>專案錯誤：</strong>{projectWsData.error}
                              </Alert>
                            </Box>
                          )}
                        </Box>
                      </Stack>}
                    </TableCell>
                  </TableRow>
                </Fragment>
              );
            })}
            {/* 懶加載時底部 loading 標誌 */}
            {projectOutboundDataIsloading && hasMore && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ borderBottom: 'none', py: 2 }}>
                  <CircularProgress size={32} />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table> 
      </Box>
      <ProjectCustomersDialog onOpen={Boolean(expandedProjectId)} onClose={()=>{handleExpandClick(false)}} projectId={expandedProjectId}/>
    </>
  );
};