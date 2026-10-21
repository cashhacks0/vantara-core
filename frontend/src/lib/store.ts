import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  chatPanelOpen: boolean;
  setChatPanelOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      mobileNavOpen: false,
      setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
      chatPanelOpen: true,
      setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
    }),
    { name: 'vantara-ui', partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed, chatPanelOpen: state.chatPanelOpen }) },
  ),
);

export interface Toast {
  id: number;
  title: string;
  description?: string;
  tone: 'success' | 'error' | 'info';
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

let nextToastId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = nextToastId++;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    setTimeout(() => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })), toast.tone === 'error' ? 8000 : 4000);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })),
}));

export const toast = {
  success: (title: string, description?: string) => useToastStore.getState().push({ title, description, tone: 'success' }),
  error: (title: string, description?: string) => useToastStore.getState().push({ title, description, tone: 'error' }),
  info: (title: string, description?: string) => useToastStore.getState().push({ title, description, tone: 'info' }),
};
