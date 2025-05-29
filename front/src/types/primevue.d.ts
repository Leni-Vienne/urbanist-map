// AI : Type declarations for PrimeVue modules that don't have proper TypeScript support
declare module 'primevue/toasteventbus' {
  export interface ToastEventBus {
    emit(event: string, ...args: any[]): void;
    on(event: string, callback: (...args: any[]) => void): void;
    off(event: string, callback?: (...args: any[]) => void): void;
  }
  
  const ToastEventBus: ToastEventBus;
  export default ToastEventBus;
}
