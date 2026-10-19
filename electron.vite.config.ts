import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        // Three renderer entries (#45): the dashboard, the feed panel's
        // overlay page and the Weigh-in pop-up's — both composite above the
        // browser pane's WebContentsView, which dashboard DOM cannot do.
        input: {
          index: 'src/renderer/index.html',
          overlay: 'src/renderer/overlay.html',
          weighin: 'src/renderer/weighin.html',
        },
      },
    },
  },
})
