import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { logger } from '@/lib/logger'

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-03-31.basil' })
}

// Use service-role client to bypass RLS
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(req: NextRequest) {
  const stripe = getStripe()
  const body = await req.text()
  const sig  = req.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  logger.info('stripe-webhook', `Received event: ${event.type}`)

  const supabase = getAdminClient()

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const supabaseId = session.metadata?.supabase_id
      if (!supabaseId) break

      // Retrieve subscription to get period end
      if (session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription as string)

        logger.info('stripe-webhook', `Upgrading user to pro: ${supabaseId}`)

        const periodEnd = sub.items.data[0]?.current_period_end
        const { error } = await supabase.from('profiles').update({
          subscription: 'pro',
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: sub.id,
          subscription_ends_at: periodEnd != null ? new Date(periodEnd * 1000).toISOString() : null,
        }).eq('id', supabaseId)

        if (error) {
          logger.error('stripe-webhook', `DB update failed for user ${supabaseId}`, { error: error.message })
          return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
        }

        logger.info('stripe-webhook', `Successfully upgraded user to pro: ${supabaseId}`)
      }
      break
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const customerId = sub.customer as string

      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single()

      if (profile) {
        const userId = (profile as { id: string }).id
        const active = ['active', 'trialing'].includes(sub.status)

        logger.info('stripe-webhook', `Updating subscription for user ${userId}: status=${sub.status}, active=${active}`)

        const periodEnd = sub.items.data[0]?.current_period_end
        const { error } = await supabase.from('profiles').update({
          subscription: active ? 'pro' : 'free',
          subscription_ends_at: periodEnd != null ? new Date(periodEnd * 1000).toISOString() : null,
        }).eq('id', userId)

        if (error) {
          logger.error('stripe-webhook', `DB update failed for user ${userId}`, { error: error.message })
          return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
        }

        logger.info('stripe-webhook', `Successfully updated subscription for user ${userId}`)
      }
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const customerId = sub.customer as string

      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single()

      if (profile) {
        const userId = (profile as { id: string }).id

        logger.info('stripe-webhook', `Downgrading user to free: ${userId}`)

        const { error } = await supabase.from('profiles').update({
          subscription: 'free',
          stripe_subscription_id: null,
          subscription_ends_at: null,
        }).eq('id', userId)

        if (error) {
          logger.error('stripe-webhook', `DB update failed for user ${userId}`, { error: error.message })
          return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
        }

        logger.info('stripe-webhook', `Successfully downgraded user to free: ${userId}`)
      }
      break
    }
  }

  return NextResponse.json({ received: true })
}
