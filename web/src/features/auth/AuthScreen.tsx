import { useState } from 'react';
import type { FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, Lock, LogIn, User, UserPlus } from 'lucide-react';
import { useAuth } from '../../state/AuthContext';
import { ApiError } from '../../shared/lib/api';
import { ErrorBanner } from '../../shared/ErrorBanner';
import { ShaderBackground } from '@/components/motion/shader-background';
import { Input } from '@/components/motion/input';
import { Button } from '@/components/motion/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/motion/tabs';
import { EASE_OUT } from '@/shared/lib/ease';

// A dark, on-brand mesh — background near-black, blurple/fuchsia/purple echo
// the accent palette in index.css instead of arbitrary shader-demo colors.
const MESH_COLORS = ['#0a0912', '#4f46e5', '#eb459e', '#1c1030'];

function PasswordToggle({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}>
      {visible ? <EyeOff /> : <Eye />}
    </button>
  );
}

function LoginForm() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
      <Input
        id="loginUsername"
        label="Usuário"
        autoFocus
        autoComplete="username"
        leftIcon={<User />}
        value={username}
        onChange={setUsername}
      />
      <Input
        id="loginPassword"
        label="Senha"
        type={showPassword ? 'text' : 'password'}
        autoComplete="current-password"
        leftIcon={<Lock />}
        rightIcon={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
        value={password}
        onChange={setPassword}
      />
      <Button type="submit" size="lg" className="mt-1 w-full" disabled={pending || !username || !password}>
        {pending ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
        <span>{pending ? 'Entrando…' : 'Entrar'}</span>
        {!pending && <ArrowRight size={16} className="ml-auto" />}
      </Button>
      {error && <ErrorBanner>{error}</ErrorBanner>}
    </form>
  );
}

interface RegisterFieldErrors {
  username?: string;
  password?: string;
  code?: string;
}

function RegisterForm() {
  const { register } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<RegisterFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setPending(true);
    try {
      // The server still expects a confirmation to match — there's no
      // second field to collect it from anymore, so the password itself
      // stands in (it trivially matches, the check just becomes a no-op).
      await register(username, password, password, code);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'username_taken' || err.code === 'invalid_username') {
          setFieldErrors({ username: err.message });
        } else if (err.code === 'weak_password' || err.code === 'password_mismatch') {
          setFieldErrors({ password: err.message });
        } else if (err.code === 'invalid_code') {
          setFieldErrors({ code: err.message });
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError('Não foi possível criar a conta.');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
      <Input
        id="registerUsername"
        label="Usuário"
        autoFocus
        autoComplete="username"
        maxLength={20}
        placeholder="3 a 20 caracteres"
        leftIcon={<User />}
        value={username}
        onChange={setUsername}
        error={fieldErrors.username}
        reserveErrorLine
      />
      <Input
        id="registerPassword"
        label="Senha"
        type={showPassword ? 'text' : 'password'}
        autoComplete="new-password"
        placeholder="Pelo menos 8 caracteres"
        leftIcon={<Lock />}
        rightIcon={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
        value={password}
        onChange={setPassword}
        error={fieldErrors.password}
        reserveErrorLine
      />
      <Input
        id="registerCode"
        label="Código de convite"
        leftIcon={<KeyRound />}
        value={code}
        onChange={setCode}
        error={fieldErrors.code}
        reserveErrorLine
      />
      <Button type="submit" size="lg" className="mt-1 w-full" disabled={pending || !username || !password || !code}>
        {pending ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
        <span>{pending ? 'Criando conta…' : 'Criar conta'}</span>
        {!pending && <ArrowRight size={16} className="ml-auto" />}
      </Button>
      {formError && <ErrorBanner>{formError}</ErrorBanner>}
    </form>
  );
}

export function AuthScreen() {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const reduce = useReducedMotion();
  const panelTransition = reduce ? { duration: 0 } : { duration: 0.15, ease: EASE_OUT };

  return (
    <div className="relative flex h-dvh items-center justify-center overflow-hidden bg-bg-primary p-4">
      <div className="absolute inset-0">
        <ShaderBackground
          variant="mesh-gradient"
          colors={MESH_COLORS}
          distortion={0.85}
          swirl={0.35}
          speed={0.25}
          className="absolute inset-0"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/10 via-black/25 to-black/60" />
      </div>

      <div className="relative z-10 flex w-full max-w-100 flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <img src="/logo.svg" alt="" className="h-12 w-12 drop-shadow-[0_4px_16px_rgba(0,0,0,0.45)]" />
          <div>
            <h1 className="text-display font-bold tracking-tight text-white drop-shadow-sm">Linkord</h1>
            <p className="text-label text-white/70">Converse e faça chamadas com seu grupo</p>
          </div>
        </div>

        <motion.div layout={!reduce} className="w-full overflow-hidden rounded-2xl border border-white/10 bg-bg-floating/70 p-6 shadow-2xl backdrop-blur-2xl">
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'login' | 'register')} variant="segment" className="flex w-full flex-col gap-5">
            <TabsList className="w-full grid grid-cols-2 rounded-xl border border-white/10 bg-black/25 p-1">
              <TabsTrigger value="login" className="w-full rounded-lg">Entrar</TabsTrigger>
              <TabsTrigger value="register" className="w-full rounded-lg">Criar conta</TabsTrigger>
            </TabsList>
            {/* The card itself carries `layout` (above), so its height
                animates smoothly frame-by-frame as the panel below swaps —
                that's what keeps the tab pill's own slide animation and the
                card's resize in sync instead of fighting (an instant CSS
                height snap used to yank the whole centered column out from
                under the pill mid-transition). */}
            <AnimatePresence initial={false} mode="popLayout">
              {tab === 'login' ? (
                <motion.div key="login" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={panelTransition}>
                  <LoginForm />
                </motion.div>
              ) : (
                <motion.div key="register" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={panelTransition}>
                  <RegisterForm />
                </motion.div>
              )}
            </AnimatePresence>
          </Tabs>
        </motion.div>
      </div>
    </div>
  );
}
