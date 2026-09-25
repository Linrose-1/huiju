import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'mysql',
  schema: './src/database/schema/*.ts',
  out: './drizzle',
  dbCredentials: process.env.DATABASE_URL
    ? { url: process.env.DATABASE_URL }
    : undefined,
})
