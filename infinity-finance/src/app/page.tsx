import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// Root — middleware handles redirect to /dashboard or /login
export default function Home() {
  redirect('/dashboard')
}
