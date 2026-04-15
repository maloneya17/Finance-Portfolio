import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) {
    // Log but don't crash production — fall back to origin with a warning
    console.error('[auth/callback] NEXT_PUBLIC_APP_URL is not set — open redirect risk')
  }

  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const rawNext = searchParams.get('next') ?? '/dashboard'

  // Validate next param — must be a relative path, not a protocol-relative or absolute URL
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard'

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!baseUrl) {
    return NextResponse.redirect(`${origin}/login?error=configuration_error`)
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${baseUrl}${next}`)
    }
  }

  return NextResponse.redirect(`${baseUrl}/login?error=auth_callback_failed`)
}
