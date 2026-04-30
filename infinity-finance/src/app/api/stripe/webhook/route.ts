import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { logger } from '@/lib/logger'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  return new Stripe(key, { apiVersion: '2025-03-31.basil' })
}

// Use service-role client to bypass RLS
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service-role env vars are not configured')
  return createClient(url, key)
}

export async function POST(req: NextRequest) {
  const stripe = getStripe()
  const body = await req.text()
  const sig  = req.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    logger.error('stripe-webhook', 'STRIPE_WEBHOOK_SECRET is not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
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

        // Idempotency guard: skip if this subscription has already been applied
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('stripe_subscription_id')
          .eq('id', supabaseId)
          .single()

        if (existingProfile && (existingProfile as { stripe_subscription_id: string | null }).stripe_subscription_id === sub.id) {
          logger.warn('stripe-webhook', `Duplicate checkout.session.completed for subscription ${sub.id} — skipping`)
          break
        }

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

      if (!profile) {
        logger.warn('stripe-webhook', `No profile found for customer ${customerId} on subscription.updated`)
        break
      }

      {
        const userId = (profile as { id: string }).id
        // Keep users as Pro during past_due (grace period); only downgrade on canceled/unpaid/incomplete_expired
        const active = ['active', 'trialing', 'past_due'].includes(sub.status)

        logger.info('stripe-webhook', `Updating subscription for user ${userId}: status=${sub.status}, active=${active}`)

        const periodEnd = sub.items.data[0]?.current_period_end
        const { error } = await supabase.from('profiles').update({
          subscription: active ? 'pro' : 'free',
          stripe_subscription_id: sub.id,
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

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string
      logger.warn('stripe-webhook', `Payment failed for customer ${customerId}`)
      break
    }

    case 'customer.subscription.trial_will_end': {
      const sub = event.data.object as Stripe.Subscription
      logger.info('stripe-webhook', `Trial ending for subscription ${sub.id} (customer: ${sub.customer as string})`)
      // TODO: send trial-ending notification email
      break
    }

    case 'invoice.payment_succeeded':
    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string
      if (!customerId) break

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, subscription, subscription_ends_at')
        .eq('stripe_customer_id', customerId)
        .single()

      if (!profile) {
        logger.warn('stripe-webhook', `No profile found for customer ${customerId} on invoice.paid`)
        break
      }

      // Retrieve the subscription to get the latest period end
      // In Stripe v22 the subscription reference moved from invoice.subscription to invoice.parent.subscription
      const subscriptionRef = invoice.parent?.type === 'subscription_details'
        ? invoice.parent.subscription_details?.subscription
        : null
      if (subscriptionRef) {
        const subId = typeof subscriptionRef === 'string' ? subscriptionRef : subscriptionRef.id
        const sub = await stripe.subscriptions.retrieve(subId)
        const periodEnd = sub.items.data[0]?.current_period_end
        const userId = (profile as { id: string; subscription: string; subscription_ends_at: string | null }).id
        const newPeriodEndISO = periodEnd != null ? new Date(periodEnd * 1000).toISOString() : null

        // Idempotency guard: skip if subscription is already pro with the same period end
        const typedProfile = profile as { id: string; subscription: string; subscription_ends_at: string | null }
        if (typedProfile.subscription === 'pro' && typedProfile.subscription_ends_at === newPeriodEndISO) {
          logger.warn('stripe-webhook', `Duplicate invoice.paid for user ${userId} — skipping`)
          break
        }

        const { error } = await supabase.from('profiles').update({
          subscription: 'pro',
          subscription_ends_at: newPeriodEndISO,
        }).eq('id', userId)

        if (error) {
          logger.error('stripe-webhook', `DB update failed for invoice.paid user ${userId}`, { error: error.message })
          return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
        }

        logger.info('stripe-webhook', `Renewed Pro access for user ${userId} via invoice.paid`)
      }
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const customerId = sub.customer as string

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, stripe_subscription_id')
        .eq('stripe_customer_id', customerId)
        .single()

      if (!profile) {
        logger.warn('stripe-webhook', `No profile found for customer ${customerId} on subscription.deleted`)
        break
      }

      {
        // Idempotency guard: skip if user has re-subscribed with a different subscription
        const typedProfile = profile as { id: string; stripe_subscription_id: string | null }
        if (typedProfile.stripe_subscription_id !== sub.id) {
          logger.warn('stripe-webhook', `Skipping subscription.deleted for ${customerId} — subscription ID mismatch (user may have re-subscribed)`)
          break
        }

        const userId = typedProfile.id

        logger.info('stripe-webhook', `Downgrading user to free: ${userId}`)

        const periodEnd = sub.items.data[0]?.current_period_end
        const periodEndDate = periodEnd ? new Date(periodEnd * 1000) : null
        const now = new Date()

        const { error } = await supabase.from('profiles').update({
          subscription: 'free',
          stripe_subscription_id: null,
          subscription_ends_at: periodEndDate && periodEndDate > now
            ? periodEndDate.toISOString()
            : null,
        }).eq('id', userId)

        if (error) {
          logger.error('stripe-webhook', `DB update failed for user ${userId}`, { error: error.message })
          return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
        }

        logger.info('stripe-webhook', `Successfully downgraded user to free: ${userId}`)
      }
      break
    }

    default:
      logger.info('stripe-webhook', `Unhandled event type: ${event.type}`)
      break
  }

  return NextResponse.json({ received: true })
}
