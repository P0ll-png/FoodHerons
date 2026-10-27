import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Runtime error (not a build failure): the client needs the public anon key.
  // Real values live in .env.local (git-ignored). The service-role key must
  // NEVER be used in the browser — RLS protects the data.
  throw new Error(
    'Missing Supabase env vars: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local'
  )
}

// Singleton browser client. Default session persistence (localStorage) is kept.
export const supabase = createClient(url, anonKey)
