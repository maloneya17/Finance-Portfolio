import { createBrowserClient } from '@supabase/ssr'

// Note: once you have a Supabase project, regenerate proper types with:
//   npx supabase gen types typescript --project-id <id> > src/types/database.generated.ts
// For now we use untyped client + manual type assertions.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
