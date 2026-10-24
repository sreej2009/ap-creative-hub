import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Input } from '../../components/ui/Field';
import { Sparkle } from '../../components/ui/Icons';
import { useAdminMe, type AdminSession } from '../../hooks/useAuth';
import { useDocumentTitle } from '../../hooks/useStore';
import { api, errorMessage } from '../../lib/api';

const schema = z.object({ email: z.string().trim().email('Enter a valid email'), password: z.string().min(1, 'Enter your password') });

export default function AdminLogin() {
  useDocumentTitle('Admin sign in');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: session } = useAdminMe();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const next = params.get('next')?.startsWith('/admin') ? params.get('next')! : '/admin';
  const login = useMutation({
    mutationFn: (v: z.infer<typeof schema>) => api.post<AdminSession>('/auth/admin/login', v),
    onSuccess: (s) => {
      qc.setQueryData(['admin-me'], s);
      navigate(next, { replace: true });
    },
  });
  if (session) return <Navigate to={next} replace />;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-plum-900 px-4 py-10">
      <div className="relative w-full max-w-sm">
        <Sparkle aria-hidden className="absolute -left-6 -top-6 size-6 animate-twinkle text-gold-400" />
        <div className="rounded-[28px] bg-paper p-8 shadow-lift">
          <div className="text-center">
            <span className="font-display text-4xl font-semibold italic">
              A<span className="text-gold-500">&amp;</span>P
            </span>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.32em] text-rose-700">Admin portal</p>
          </div>
          <form noValidate className="mt-8 space-y-4" onSubmit={form.handleSubmit((v) => login.mutate(v))}>
            {login.error && <Alert tone="danger">{errorMessage(login.error)}</Alert>}
            <Input label="Email" type="email" autoComplete="username" required {...form.register('email')} error={form.formState.errors.email?.message} />
            <Input label="Password" type="password" autoComplete="current-password" required {...form.register('password')} error={form.formState.errors.password?.message} />
            <Button type="submit" block size="lg" loading={login.isPending} icon={<Lock className="size-4" />}>
              Sign in
            </Button>
          </form>
          <p className="mt-6 text-center text-xs text-muted">Authorised staff only. Accounts are created by the store owner.</p>
        </div>
      </div>
    </div>
  );
}
