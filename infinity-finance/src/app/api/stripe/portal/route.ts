import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { rateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  return new Stripe(key, { apiVersion: '2025-03-31.basil' })
}

export async function POST() {
  const stripe = getStripe()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`portal:${user.id}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { data: profile } = await supabase.from('profiles').select('stripe_customer_id').eq('id', user.id).single()
  const customerId = (profile as { stripe_customer_id: string | null } | null)?.stripe_customer_id

  if (!customerId) {
    return NextResponse.json({ url: `${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=billing` })
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer:   customerId,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=billing`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    logger.error('stripe-portal', 'Stripe API call failed', { error: String(err) })
    return NextResponse.json({ error: 'Payment service unavailable' }, { status: 503 })
  }
}
