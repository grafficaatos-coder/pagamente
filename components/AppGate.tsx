'use client';

import { useState } from 'react';
import { LockKeyhole, WalletCards } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';

export default function AppGate({ children }: { children: React.ReactNode }) {
  const { mode, user, loading, signIn, signUp, resendConfirmation } = useAuth();
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  if (mode === 'demo') return <>{children}</>;
  if (loading) return <div className="auth-page"><div className="auth-loading">Carregando Sistema de Cobrança…</div></div>;
  if (user) return <>{children}</>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      if (tab === 'login') await signIn(email, password);
      else setMessage(await signUp(name, company, email, password));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível concluir a operação.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setMessage('');
    try {
      setMessage(await resendConfirmation(email));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível reenviar a confirmação.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="auth-page">
    <div className="auth-brand">
      <div className="brand-mark"><WalletCards size={26}/></div>
      <div><strong>Sistema de Cobrança</strong><span>Gestão de cobranças simples e segura</span></div>
    </div>
    <form className="auth-card" onSubmit={submit}>
      <div className="auth-icon"><LockKeyhole size={22}/></div>
      <h1>{tab === 'login' ? 'Acesse sua conta' : 'Crie sua conta'}</h1>
      <p>{tab === 'login' ? 'Entre para gerenciar cobranças, clientes e recebimentos.' : 'Você começa com 14 dias de teste.'}</p>
      {tab === 'signup' && <>
        <label>Seu nome<input value={name} onChange={e=>setName(e.target.value)} required /></label>
        <label>Empresa<input value={company} onChange={e=>setCompany(e.target.value)} required /></label>
      </>}
      <label>E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required /></label>
      <label>Senha<input type="password" minLength={6} value={password} onChange={e=>setPassword(e.target.value)} required /></label>
      {message && <div className="auth-message">{message}</div>}
      <button className="btn btn-primary btn-wide" disabled={busy}>{busy ? 'Processando…' : tab === 'login' ? 'Entrar' : 'Criar conta'}</button>
      <button type="button" className="auth-switch" onClick={()=>{setTab(tab === 'login' ? 'signup' : 'login');setMessage('')}}>
        {tab === 'login' ? 'Ainda não tenho conta' : 'Já tenho uma conta'}
      </button>
      <button type="button" className="auth-switch" onClick={resend} disabled={busy || !email}>
        Reenviar e-mail de confirmação
      </button>
    </form>
  </div>;
}
