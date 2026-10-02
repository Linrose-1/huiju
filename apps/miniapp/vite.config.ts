import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

export default defineConfig(({ mode }) => {
  if (['local-test','circle-review'].includes(mode) && process.env.NODE_ENV !== 'development') {
    throw new Error('Test modes are only available for development; use the normal build for release')
  }
  return {
    plugins: [uni()],
    define: { 'import.meta.env.HUIJU_LOCAL_TEST': JSON.stringify(['local-test','circle-review'].includes(mode)), 'import.meta.env.HUIJU_CIRCLE_REVIEW': JSON.stringify(mode === 'circle-review') }
  }
})
