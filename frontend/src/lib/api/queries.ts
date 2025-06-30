import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
import { healthApi, sessionApi } from './api';
import type { CreateSessionRequest } from './types';

// Query key factory
export const queryKeys = {
  health: ['health'] as const,
  healthStatus: () => [...queryKeys.health, 'status'] as const,
  healthMetrics: () => [...queryKeys.health, 'metrics'] as const,
  sessions: ['sessions'] as const,
  session: (id: string) => [...queryKeys.sessions, id] as const,
};

// Health queries
export function createHealthQuery() {
  return createQuery({
    queryKey: queryKeys.healthStatus(),
    queryFn: () => healthApi.getHealth(),
    refetchInterval: 30000, // Poll every 30 seconds
    staleTime: 10000, // Consider stale after 10 seconds
  });
}

export function createMetricsQuery() {
  return createQuery({
    queryKey: queryKeys.healthMetrics(),
    queryFn: () => healthApi.getMetrics(),
    refetchInterval: 15000, // Poll every 15 seconds
    staleTime: 5000, // Consider stale after 5 seconds
  });
}

// Session queries
export function createSessionQuery(sessionId: string) {
  return createQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => sessionApi.getSession(sessionId),
    refetchInterval: 5000, // Poll every 5 seconds
    staleTime: 1000, // Consider data stale after 1 second
  });
}

// Session mutations
export function createSessionMutation() {
  const queryClient = useQueryClient();
  
  return createMutation({
    mutationFn: (data: CreateSessionRequest) => sessionApi.createSession(data),
    onSuccess: () => {
      // Invalidate health metrics to show updated counts
      queryClient.invalidateQueries({ 
        queryKey: queryKeys.healthMetrics() 
      });
    },
  });
}

export function createDeleteSessionMutation() {
  const queryClient = useQueryClient();
  
  return createMutation({
    mutationFn: (sessionId: string) => sessionApi.deleteSession(sessionId),
    onSuccess: (_, sessionId) => {
      // Remove from cache
      queryClient.removeQueries({ 
        queryKey: queryKeys.session(sessionId) 
      });
      // Invalidate health metrics
      queryClient.invalidateQueries({ 
        queryKey: queryKeys.healthMetrics() 
      });
    },
  });
}