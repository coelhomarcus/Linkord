import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight, Loader2, LogIn, UserPlus } from 'lucide-react';
import { useAuth } from '../../state/AuthContext';
import { ApiError } from '../../shared/lib/api';
import { ErrorBanner } from '../../shared/ErrorBanner';
import { sectionLabelClass } from '../../shared/SectionLabel';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsIndicator, TabsTrigger, TabsPanel } from '@/components/ui/tabs';

function LoginForm() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel entrar.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="loginUsername" className={sectionLabelClass}>Usuario</Label>
        <Input id="loginUsername" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="loginPassword" className={sectionLabelClass}>Senha</Label>
        <Input id="loginPassword" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending || !username || !password}>
        {pending ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
        <span>{pending ? 'Entrando…' : 'Entrar'}</span>
        {!pending && <ArrowRight size={16} className="ml-auto" />}
      </Button>
      {error && <ErrorBanner>{error}</ErrorBanner>}
    </form>
  );
}

function RegisterForm() {
  const { register } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('As senhas nao coincidem.');
      return;
    }
    setPending(true);
    try {
      await register(username, password, confirmPassword, code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel criar a conta.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="registerUsername" className={sectionLabelClass}>Usuario</Label>
        <Input
          id="registerUsername"
          autoFocus
          autoComplete="username"
          maxLength={20}
          placeholder="3 a 20 caracteres"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="registerPassword" className={sectionLabelClass}>Senha</Label>
        <Input
          id="registerPassword"
          type="password"
          autoComplete="new-password"
          placeholder="Pelo menos 8 caracteres"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="registerConfirmPassword" className={sectionLabelClass}>Confirmar senha</Label>
        <Input
          id="registerConfirmPassword"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="registerCode" className={sectionLabelClass}>Codigo de convite</Label>
        <Input id="registerCode" value={code} onChange={(e) => setCode(e.target.value)} />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending || !username || !password || !confirmPassword || !code}>
        {pending ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
        <span>{pending ? 'Criando conta…' : 'Criar conta'}</span>
        {!pending && <ArrowRight size={16} className="ml-auto" />}
      </Button>
      {error && <ErrorBanner>{error}</ErrorBanner>}
    </form>
  );
}

/** Tela cheia (nao um modal — nao ha nada atras dela pra escurecer) mostrada
 * enquanto ninguem esta logado. So depois dela existir e que o RoomProvider
 * monta e abre o socket — nunca ha conexao anonima. */
export function AuthScreen() {
  return (
    <div className="flex h-dvh items-center justify-center bg-bg-primary p-4">
      <div className="flex w-full max-w-100 flex-col gap-1 rounded-xl border border-strong bg-bg-floating p-6">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="" className="h-8 w-8 flex-none" />
          <h1 className="text-display font-bold tracking-tight text-text-primary">Linkord</h1>
        </div>
        <Separator className="my-2" />
        <Tabs defaultValue="login" className="w-full flex-col items-stretch gap-4">
          <TabsList className="w-full">
            <TabsIndicator />
            <TabsTrigger value="login" className="flex-1">Entrar</TabsTrigger>
            <TabsTrigger value="register" className="flex-1">Criar conta</TabsTrigger>
          </TabsList>
          <TabsPanel value="login"><LoginForm /></TabsPanel>
          <TabsPanel value="register"><RegisterForm /></TabsPanel>
        </Tabs>
      </div>
    </div>
  );
}
