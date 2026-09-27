import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

export default defineConfig(({ mode }) => {
  if (mode === 'local-test' && process.env.NODE_ENV !== 'development') {
    throw new Error('local-test is only available for development; use the normal build for release')
  }
  return {
    plugins: [uni()],
    define: { 'import.meta.env.HUIJU_LOCAL_TEST': JSON.stringify(mode === 'local-test') }
  }
})
