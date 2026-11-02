import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4030
  },
  resolve: {
    alias: {
      '@outbound': resolve(__dirname, 'src/features/outbound-campaign'),
      '@call-schedule': resolve(__dirname, 'src/features/call-schedule'),
      '@shared': resolve(__dirname, 'src/shared'),
    }
  }
})
