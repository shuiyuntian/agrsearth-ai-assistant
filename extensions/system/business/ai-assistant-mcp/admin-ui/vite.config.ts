import { defineAdminUiConfig } from '@agrsearth/vite-config/admin'

export default defineAdminUiConfig({
  entry: './src/index.ts',
  name: 'AdminUI_ai_assistant_mcp',
  exports: 'named',
  alias: {
    '@shared/admin-sdk': '@agrsearth/admin-sdk'
  }
})
