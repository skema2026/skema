import axios from 'axios';

const clearBrowserAuth = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('auth-storage');
  document.cookie = 'token=; path=/; max-age=0; SameSite=Lax';
};

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      const isAuthEndpoint =
        error.config?.url?.includes('/auth/token') ||
        error.config?.url?.includes('/auth/login');
      if (!isAuthEndpoint) {
        clearBrowserAuth();
        window.location.replace('/login');
      }
    }
    return Promise.reject(error);
  }
);
