// API Response 型別
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  timestamp: string;
}

// WebSocket 型別
export * from './websocket';

// 使用者相關型別
export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
  MODERATOR = 'moderator'
}

export interface CreateUserRequest {
  email: string;
  name: string;
  password: string;
}

export interface UpdateUserRequest {
  name?: string;
  avatar?: string;
}

// 分頁相關型別
export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// 驗證相關型別
export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  token: string;
  refreshToken: string;
}

// Socket.IO 事件型別
export interface ServerToClientEvents {
  message: (data: { message: string; timestamp: string }) => void;
  userJoined: (user: User) => void;
  userLeft: (userId: string) => void;
}

export interface ClientToServerEvents {
  sendMessage: (message: string) => void;
  joinRoom: (roomId: string) => void;
  leaveRoom: (roomId: string) => void;
}

// Call Schedule 相關型別
export interface CallScheduleRecord {
  id: string;
  audioFile: string; // 鈴聲名稱，例如: "預設鈴聲"
  date: string; // 日期，例如: "2025/12/05 07:30"
  extension: string; // 分機號，例如: "A館 10F - 1002"
  callStatus: '排程中' | '已完成' | '失敗'; // 撥號狀態
  callRecord?: string; // 撥號紀錄
  notes?: string; // 備註
  notificationContent: string; // 通知內容
  retryInterval: string; // 重試間隔，單位分鐘
  createdAt?: string; // 建立時間
  updatedAt?: string; // 更新時間
}

export interface CallScheduleFilters {
  startDate?: string | null;
  endDate?: string | null;
  status?: string[]; // 可多選: ['全部'] | ['排程中', '已完成', '失敗']
  search?: string; // 搜尋分機號
}

export type CallStatus = '排程中' | '已完成' | '失敗';

// Call Schedule API 請求/回應型別
export interface CreateCallScheduleRequest {
  audioFile: string;
  date: string;
  extension: string;
  notificationContent: string;
  retryInterval: string;
  notes?: string;
}

export interface UpdateCallScheduleRequest {
  audioFile?: string;
  date?: string;
  extension?: string;
  callStatus?: CallStatus;
  callRecord?: string;
  notificationContent?: string;
  retryInterval?: string;
  notes?: string;
}

export interface GetCallSchedulesQuery extends PaginationQuery {
  startDate?: string;
  endDate?: string;
  status?: string;
  search?: string;
}