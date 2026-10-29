import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor shell for REWIND BOWL '87.
 *
 * The game is a plain Vite bundle copied into the native projects, so the same
 * `dist/` runs in the browser, in the preview panel, and on a phone.
 *
 * Build/sign/submit steps live in MOBILE.md.
 */
const config: CapacitorConfig = {
  appId: 'com.rewindbowl.game',
  appName: "Rewind Bowl '87",
  webDir: 'dist',
  backgroundColor: '#080b12',

  // https origin on Android keeps localStorage, canvas and WebAudio in a secure
  // context, matching the browser build. iOS keeps Capacitor's default scheme.
  server: {
    androidScheme: 'https',
  },

  android: {
    backgroundColor: '#080b12',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },

  ios: {
    backgroundColor: '#080b12',
    // The game owns its own scrolling and lays out to the safe areas itself.
    contentInset: 'never',
    scrollEnabled: false,
    preferredContentMode: 'mobile',
  },

  plugins: {
    SplashScreen: {
      // Held until React has painted the title screen (src/native.ts), so the
      // handoff is a cut, not a flash of half-drawn canvas.
      launchAutoHide: false,
      launchShowDuration: 0,
      backgroundColor: '#080b12',
      androidScaleType: 'CENTER_CROP',
      androidSplashResourceName: 'splash',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      // Draw under the status bar; styles.css pads with env(safe-area-inset-*).
      overlaysWebView: true,
      style: 'DARK',
      backgroundColor: '#080b12',
    },
  },
};

export default config;
