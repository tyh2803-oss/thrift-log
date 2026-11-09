import { Login } from '@/components/login';
import { configured } from '@/lib/supabase/server';
export const dynamic = 'force-dynamic';
export default function Page() {
  return <Login configured={configured()} />;
}
