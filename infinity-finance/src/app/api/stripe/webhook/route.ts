import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

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

  const supabase = getAdminClient()

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const supabaseId = session.metadata?.supabase_id
      if (!supabaseId) break

      // Retrieve subscription to get period end
      if (session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription as string)
        await supabase.from('profiles').update({
          subscription: 'pro',
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: sub.id,
          subscription_ends_at: new Date((sub as unknown as { current_period_end: number }).current_period_end * 1000).toISOString(),
        } as never).eq('id', supabaseId)
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
        const active = ['active', 'trialing'].includes(sub.status)
        await supabase.from('profiles').update({
          subscription: active ? 'pro' : 'free',
          subscription_ends_at: new Date((sub as unknown as { current_period_end: number }).current_period_end * 1000).toISOString(),
        } as never).eq('id', (profile as { id: string }).id)
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
        await supabase.from('profiles').update({
          subscription: 'free',
          stripe_subscription_id: null,
          subscription_ends_at: null,
        } as never).eq('id', (profile as { id: string }).id)
      }
      break
    }
  }

  return NextResponse.json({ received: true })
}
