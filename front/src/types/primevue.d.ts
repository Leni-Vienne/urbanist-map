declare module 'primevue/config' {
  interface PrimeVueConfiguration {
    ripple?: boolean;
    inputStyle?: string;
    zIndex?: {
      modal?: number;
      overlay?: number;
      menu?: number;
      tooltip?: number;
    };
  }
}