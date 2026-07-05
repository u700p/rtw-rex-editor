import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const FALLBACK_BASE44_URL = 'https://base44.app';

function normalizeHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : '';
  } catch {
    return '';
  }
}

const appBaseUrl = normalizeHttpUrl(process.env.VITE_BASE44_APP_BASE_URL || process.env.VITE_BASE44_SERVER_URL) || FALLBACK_BASE44_URL;
process.env.VITE_BASE44_APP_BASE_URL = appBaseUrl;
process.env.VITE_BASE44_SERVER_URL = normalizeHttpUrl(process.env.VITE_BASE44_SERVER_URL) || appBaseUrl;

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  logLevel: 'error', // Suppress warnings, only show errors
  plugins: [
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
      hmrNotifier: true,
      navigationNotifier: true,
      analyticsTracker: true,
      visualEditAgent: true
    }),
    react(),
  ]
});
