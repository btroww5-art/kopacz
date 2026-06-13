import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const fallbackSupabaseUrl = 'https://fqinkncoybjduuomxlxl.supabase.co'
const fallbackSupabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxaW5rbmNveWJqZHV1b214bHhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNjI4NDMsImV4cCI6MjA5NjkzODg0M30.xGrIJy8lQs2VVJyMXuBXcbYDgAXdiccTWqiE1QFIT20'

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || fallbackSupabaseUrl,
    ),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(
      process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || fallbackSupabaseAnonKey,
    ),
  },
  build: {
    outDir: 'dist',
  },
})
