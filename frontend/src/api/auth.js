import { api } from './client';

export const authApi = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  refresh: () => api.post('/auth/refresh'),
  logout: () => api.post('/auth/logout'),
};
