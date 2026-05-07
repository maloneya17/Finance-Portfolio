import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  // Generate a per-request nonce for the Content-Security-Policy header
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const isDev = process.env.NODE_ENV !== 'production'

  // Build the nonce-based CSP. 'unsafe-eval' is required in dev because React
  // uses eval() to reconstruct server-side error stacks in the browser.
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com",
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ')

  // Set both x-nonce and Content-Security-Policy on the request headers so
  // Next.js can extract the nonce during SSR and inject it into framework
  // <script> tags. Without this, 'strict-dynamic' blocks every script.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('content-security-policy', csp)

  // Run the Supabase session update (auth redirects), forwarding the enriched
  // request headers so NextResponse.next() inside updateSession carries them.
  const response = await updateSession(request, requestHeaders)

  // Also set the CSP on the response headers so browsers receive it.
  response.headers.set('Content-Security-Policy', csp)

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
