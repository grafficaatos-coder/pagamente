'use client';

import { useState } from 'react';
import {
  CheckCircle2, Eye, EyeOff, LockKeyhole, ShieldCheck, WalletCards
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';

export default function AppGate({ children }: { children: React.ReactNode }) {
  const { mode, user, loading, signIn, signUp, resendConfirmation, resetPassword } = useAuth();
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  if (mode === 'demo') return <>{children}</>;
  if (loading) return <div className="auth-page auth-loading-page"><div className="auth-loading">Carregando Sistema de Cobrança…</div></div>;
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

  async function forgotPassword() {
    setBusy(true);
    setMessage('');
    try {
      setMessage(await resetPassword(email));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível enviar a recuperação de senha.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="auth-page auth-v2">
    <section className="auth-showcase">
      <div className="auth-showcase-inner">
        <div className="auth-logo">
          <div className="brand-mark"><WalletCards size={24}/></div>
          <div><strong>Sistema de Cobrança</strong><span>Gestão financeira para empresas</span></div>
        </div>

        <div className="auth-pitch">
          <span className="auth-kicker">SIMPLES. ORGANIZADO. ONLINE.</span>
          <h2>Tenha suas cobranças sob controle.</h2>
          <p>Cadastre clientes, acompanhe recebimentos e organize a rotina financeira da sua empresa em um só lugar.</p>

          <div className="auth-benefits">
            <div><CheckCircle2 size={19}/><span><strong>4 dias grátis</strong><small>Teste antes de escolher seu plano.</small></span></div>
            <div><CheckCircle2 size={19}/><span><strong>Gestão de cobranças</strong><small>Acompanhe valores em aberto, pagos e vencidos.</small></span></div>
            <div><CheckCircle2 size={19}/><span><strong>Dados separados por empresa</strong><small>Cada conta acessa somente as próprias informações.</small></span></div>
          </div>
        </div>

        <div className="auth-trust"><ShieldCheck size={18}/><span>Ambiente protegido com autenticação segura.</span></div>
      </div>
    </section>

    <section className="auth-form-side">
      <div className="auth-mobile-logo">
        <div className="brand-mark"><WalletCards size={21}/></div>
        <strong>Sistema de Cobrança</strong>
      </div>

      <form className="auth-card auth-card-v2" onSubmit={submit}>
        <div className="auth-heading">
          <div className="auth-icon"><LockKeyhole size={21}/></div>
          <div>
            <h1>{tab === 'login' ? 'Acesse sua conta' : 'Crie sua conta grátis'}</h1>
            <p>{tab === 'login'
              ? 'Entre com seus dados para acessar sua empresa.'
              : 'Crie sua conta e use o sistema gratuitamente por 4 dias.'}</p>
          </div>
        </div>

        {tab === 'signup' && <>
          <label>Seu nome
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="Nome completo" required />
          </label>
          <label>Nome da empresa
            <input value={company} onChange={e=>setCompany(e.target.value)} placeholder="Sua empresa" required />
          </label>
        </>}

        <label>E-mail
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="seuemail@empresa.com.br" autoComplete="email" required />
        </label>

        <label>Senha
          <div className="password-field">
            <input
              type={showPassword ? 'text' : 'password'}
              minLength={6}
              value={password}
              onChange={e=>setPassword(e.target.value)}
              placeholder="Digite sua senha"
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              required
            />
            <button type="button" onClick={()=>setShowPassword(!showPassword)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
              {showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}
            </button>
          </div>
        </label>

        {tab === 'login' && <button type="button" className="auth-forgot" onClick={forgotPassword} disabled={busy || !email}>
          Esqueci minha senha
        </button>}

        {message && <div className="auth-message">{message}</div>}

        <button className="auth-primary" disabled={busy}>
          {busy ? 'Processando…' : tab === 'login' ? 'Entrar' : 'Criar conta grátis'}
        </button>

        <div className="auth-divider"><span>ou</span></div>

        <div className="auth-account-switch">
          <span>{tab === 'login' ? 'Primeira vez por aqui?' : 'Já possui uma conta?'}</span>
          <button type="button" onClick={()=>{setTab(tab === 'login' ? 'signup' : 'login');setMessage('')}}>
            {tab === 'login' ? 'Crie sua conta' : 'Fazer login'}
          </button>
        </div>

        {tab === 'login' && <button type="button" className="auth-resend" onClick={resend} disabled={busy || !email}>
          Reenviar e-mail de confirmação
        </button>}

        <p className="auth-terms">
          Ao continuar, você concorda com os termos de uso e política de privacidade da plataforma.
        </p>
      </form>
    </section>
  </div>;
}
