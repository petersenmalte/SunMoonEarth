import type {} from '@playwright/test';

declare global {
  interface Window {
    __sunMoonEarth?: {
      state: () => unknown;
      setInstant: (iso: string) => void;
      setLocation: (id: string) => void;
      setView: (view: 'sky' | 'system') => void;
    };
  }
}
