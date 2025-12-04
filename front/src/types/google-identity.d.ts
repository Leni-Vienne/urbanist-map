// AI : Google Identity Services types
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
            auto_select?: boolean
            cancel_on_tap_outside?: boolean
          }) => void
          prompt: () => void
          renderButton: (element: HTMLElement, config: {
            theme?: 'outline' | 'filled_blue' | 'filled_black'
            size?: 'large' | 'medium' | 'small'
            type?: 'standard' | 'icon'
            shape?: 'rectangular' | 'pill' | 'circle' | 'square'
            text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
            logo_alignment?: 'left' | 'center'
            width?: string
            locale?: string
          }) => void
        }
        oauth2: {
          initCodeClient: (config: {
            client_id: string
            scope: string
            ux_mode: 'popup' | 'redirect'
            callback: (response: { code: string }) => void
          }) => {
            requestCode: () => void
          }
        }
      }
    }
  }
}

// eslint-disable-next-line
export {} // important otherwise it's not global, at least according to TS