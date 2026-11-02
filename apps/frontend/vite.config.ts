import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync } from 'fs'

// 版號以 apps/frontend/package.json 為準，升版請用根目錄的 `pnpm bump`
const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 4030
  },
  resolve: {
    alias: {
      '@outbound': resolve(__dirname, 'src/features/outbound-campaign'),
      '@shared': resolve(__dirname, 'src/shared'),
    }
  }
})
