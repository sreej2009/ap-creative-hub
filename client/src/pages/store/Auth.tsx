import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { phoneSchema } from '../../components/store/AddressFields';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Input } from '../../components/ui/Field';
import { Sparkle } from '../../components/ui/Icons';
import { useAuthActions, useMe } from '../../hooks/useAuth';
import { useDocumentTitle } from '../../hooks/useStore';
import { ApiError, api, errorMessage } from '../../lib/api';

const passwordRules = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/[0-9]/, 'Include at least one number');

/** Only allow same-site relative redirects after login. */
function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/account';
}

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="container-page flex justify-center py-12 sm:py-16">
      <div className="w-full max-w-md">
        <div className="text-center">
          <Sparkle className="mx-auto size-5 text-gold-500" />
          <h1 className="mt-3 text-[38px] sm:text-[44px]">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
        </div>
        <div className="mt-8 rounded-[28px] border border-line bg-paper p-6 shadow-soft sm:p-8">{children}</div>
        {footer && <div className="mt-6 text-center text-sm text-ink-soft">{footer}</div>}
      </div>
    </div>
  );
}

function applyFieldErrors(err: unknown, setError: (name: never, e: { message: string }) => void) {
  if (err instanceof ApiError) for (const [k, m] of Object.entries(err.fieldErrors)) setError(k as never, { message: m });
}

const loginSchema = z.object({ email: z.string().trim().email('Enter a valid email'), password: z.string().min(1, 'Enter your password') });

export function Login() {
  useDocumentTitle('Sign in');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: user } = useMe();
  const { login } = useAuthActions();
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });
  const next = safeNext(params.get('next'));
  if (user) return <Navigate to={next} replace />;
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to track orders and save your favourites."
      footer={
        <>
          New here?{' '}
          <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-rose-700 underline underline-offset-2">
            Create an account
          </Link>
        </>
      }
    >
      <form noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => login.mutate(v, { onSuccess: () => navigate(next, { replace: true }) }))}>
        {login.error && <Alert tone="danger">{errorMessage(login.error)}</Alert>}
        <Input label="Email" type="email" autoComplete="email" required {...form.register('email')} error={form.formState.errors.email?.message} />
        <Input label="Password" type="password" autoComplete="current-password" required {...form.register('password')} error={form.formState.errors.password?.message} />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm text-rose-700 underline-offset-2 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" block size="lg" loading={login.isPending}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your name').max(100),
    email: z.string().trim().email('Enter a valid email'),
    phone: z.union([z.literal(''), phoneSchema]).optional(),
    password: passwordRules,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export function Register() {
  useDocumentTitle('Create account');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: user } = useMe();
  const { register: registerUser } = useAuthActions();
  const form = useForm<z.input<typeof registerSchema>>({ resolver: zodResolver(registerSchema) });
  const next = safeNext(params.get('next'));
  if (user) return <Navigate to={next} replace />;
  const e = form.formState.errors;
  return (
    <AuthShell
      title="Create your account"
      subtitle="Faster checkout, order tracking and a wishlist that follows you."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-rose-700 underline underline-offset-2">
            Sign in
          </Link>
        </>
      }
    >
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((raw) => {
          const v = registerSchema.parse(raw);
          registerUser.mutate(
            { name: v.name, email: v.email, phone: v.phone || undefined, password: v.password },
            { onSuccess: () => navigate(next, { replace: true }), onError: (err) => applyFieldErrors(err, form.setError as never) },
          );
        })}
      >
        {registerUser.error && <Alert tone="danger">{errorMessage(registerUser.error)}</Alert>}
        <Input label="Full name" autoComplete="name" required {...form.register('name')} error={e.name?.message} />
        <Input label="Email" type="email" autoComplete="email" required {...form.register('email')} error={e.email?.message} />
        <Input label="Mobile number (optional)" type="tel" prefix="+91" autoComplete="tel-national" {...form.register('phone')} error={e.phone?.message} />
        <Input label="Password" type="password" autoComplete="new-password" required hint="At least 8 characters with a letter and a number." {...form.register('password')} error={e.password?.message} />
        <Input label="Confirm password" type="password" autoComplete="new-password" required {...form.register('confirm')} error={e.confirm?.message} />
        <Button type="submit" block size="lg" loading={registerUser.isPending}>
          Create account
        </Button>
        <p className="text-center text-xs text-muted">
          By creating an account you agree to our <Link to="/terms" className="underline">terms</Link> and <Link to="/privacy" className="underline">privacy policy</Link>.
        </p>
      </form>
    </AuthShell>
  );
}

export function ForgotPassword() {
  useDocumentTitle('Reset password');
  const [sent, setSent] = useState(false);
  const form = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email: z.string().trim().email('Enter a valid email') })) });
  const m = useMutation({ mutationFn: (v: { email: string }) => api.post('/auth/forgot-password', v), onSuccess: () => setSent(true) });
  return (
    <AuthShell title="Forgot your password?" subtitle="Enter your email and we’ll send you a link to choose a new one." footer={<Link to="/login" className="text-rose-700 underline underline-offset-2">Back to sign in</Link>}>
      {sent ? (
        <Alert tone="success" title="Check your inbox">
          If an account exists for that email, a reset link is on its way. It expires in 30 minutes.
        </Alert>
      ) : (
        <form noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          {m.error && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
          <Input label="Email" type="email" autoComplete="email" required {...form.register('email')} error={form.formState.errors.email?.message} />
          <Button type="submit" block size="lg" loading={m.isPending}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

const resetSchema = z.object({ password: passwordRules, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export function ResetPassword() {
  useDocumentTitle('Choose a new password');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const form = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) });
  const m = useMutation({
    mutationFn: (v: { password: string }) => api.post('/auth/reset-password', { token, password: v.password }),
    onSuccess: () => setTimeout(() => navigate('/login', { replace: true }), 1500),
  });
  return (
    <AuthShell title="Choose a new password">
      {!token ? (
        <Alert tone="danger">This reset link is incomplete. Please request a new one.</Alert>
      ) : m.isSuccess ? (
        <Alert tone="success" title="Password updated">
          You can now sign in with your new password. Redirecting…
        </Alert>
      ) : (
        <form noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          {m.error && (
            <Alert tone="danger">
              {errorMessage(m.error)}{' '}
              <Link to="/forgot-password" className="underline">
                Request a new link
              </Link>
            </Alert>
          )}
          <Input label="New password" type="password" autoComplete="new-password" required hint="At least 8 characters with a letter and a number." {...form.register('password')} error={form.formState.errors.password?.message} />
          <Input label="Confirm password" type="password" autoComplete="new-password" required {...form.register('confirm')} error={form.formState.errors.confirm?.message} />
          <Button type="submit" block size="lg" loading={m.isPending}>
            Update password
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
