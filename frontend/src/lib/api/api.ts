// Generated API functions for OttoBot
import { apiClient } from './client';
import type { 
  CreateSessionRequest, 
  SessionResponse, 
  HealthResponse, 
  MetricsResponse,
  SessionLogsResponse 
} from './types';

export const healthApi = {
  getHealth: (): Promise<HealthResponse> => 
    apiClient.get('/health').then(res => res.data),
    
  getMetrics: (): Promise<MetricsResponse> => 
    apiClient.get('/health/metrics').then(res => res.data),
};

export const sessionApi = {
  createSession: (data: CreateSessionRequest): Promise<SessionResponse> =>
    apiClient.post('/session', data).then(res => res.data),
    
  listSessions: (params?: { limit?: number; offset?: number }): Promise<{
    sessions: SessionResponse[];
    total: number;
    limit: number;
    offset: number;
  }> =>
    apiClient.get('/session', { params }).then(res => res.data),
    
  getSession: (id: string): Promise<SessionResponse> =>
    apiClient.get(`/session/${id}`).then(res => res.data),
    
  deleteSession: (id: string): Promise<void> =>
    apiClient.delete(`/session/${id}`).then(res => res.data),
    
  getSessionLogs: (id: string, limit?: number): Promise<SessionLogsResponse> =>
    apiClient.get(`/session/${id}/logs`, { 
      params: limit ? { limit } : undefined 
    }).then(res => res.data),
};

export const downloadApi = {
  downloadSession: (sessionId: string): Promise<Blob> =>
    apiClient.get(`/download/${sessionId}`, {
      responseType: 'blob'
    }).then(res => res.data),
    
  downloadFile: (sessionId: string, filename: string): Promise<Blob> =>
    apiClient.get(`/download/${sessionId}/${filename}`, {
      responseType: 'blob'
    }).then(res => res.data),
};