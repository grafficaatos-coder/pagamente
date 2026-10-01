import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://zmrihyzwsyxjikdknfug.supabase.co';

const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'sb_publishable_nX-qLw9rEdLUvZpgXMj1LA_2gjB3umn';

export const supabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export function getSupabaseBrowserClient() {
  if (!supabaseConfigured) return null;
  if (!browserClient) {
    browserClient = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  return browserClient;
}
