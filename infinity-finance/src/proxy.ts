import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  // Generate a per-request nonce for the Content-Security-Policy header
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')

  // Run the Supabase session update (auth redirects), forwarding the nonce so
  // server components can read it via the x-nonce request header
  const response = await updateSession(request, nonce)

  // Build the nonce-based CSP (replaces the static unsafe-inline CSP in next.config.ts)
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com",
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ')

  // Attach the CSP to whatever response updateSession produced (redirect or next)
  response.headers.set('Content-Security-Policy', csp)

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
