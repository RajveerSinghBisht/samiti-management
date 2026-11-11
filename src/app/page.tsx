import { redirect } from 'next/navigation';
import { getServerSessionFromCookies } from '@/app/_auth/page-session';

export const dynamic = 'force-dynamic';

export default async function RootPage() {
  const session = await getServerSessionFromCookies();
  if (!session) {
    redirect('/login');
  }
  if (session.role === 'ADMIN') {
    if (!session.totpVerified) {
      redirect('/admin/setup-totp');
    }
    redirect('/admin');
  }
  if (session.mustChangePin) {
    redirect('/login?changePin=1');
  }
  redirect('/home');
}

