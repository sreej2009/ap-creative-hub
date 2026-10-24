import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { User } from '../lib/types';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ user: User | null }>('/auth/me').then((r) => r.user),
    staleTime: 5 * 60_000,
  });
}

export function useAuthActions() {
  const qc = useQueryClient();
  const onAuth = (user: User) => {
    qc.setQueryData(['me'], user);
    qc.invalidateQueries({ queryKey: ['account'] });
  };
  const login = useMutation({
    mutationFn: (input: { email: string; password: string }) => api.post<{ user: User }>('/auth/login', input),
    onSuccess: (r) => onAuth(r.user),
  });
  const register = useMutation({
    mutationFn: (input: { name: string; email: string; phone?: string; password: string }) => api.post<{ user: User }>('/auth/register', input),
    onSuccess: (r) => onAuth(r.user),
  });
  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSuccess: () => {
      qc.setQueryData(['me'], null);
      qc.removeQueries({ queryKey: ['account'] });
    },
  });
  return { login, register, logout };
}

export interface AdminSession {
  user: User;
  permissions: string[];
}

export function useAdminMe() {
  return useQuery({
    queryKey: ['admin-me'],
    queryFn: async () => {
      try {
        return await api.get<AdminSession>('/auth/admin/me');
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useCan(permission: string) {
  const { data } = useAdminMe();
  return !!data?.permissions.includes(permission);
}
