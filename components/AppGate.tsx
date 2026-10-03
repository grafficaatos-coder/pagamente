'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  ArrowLeft, CheckCircle2, Eye, EyeOff, LockKeyhole, Phone,
  ShieldCheck, WalletCards
} from 'lucide-react';
import { type SignUpPayload, useAuth } from '@/components/AuthProvider';

type SignupStep = 1 | 2 | 3;

const INITIAL_SIGNUP: SignUpPayload = {
  contactName: '',
  companyName: '',
  legalName: '',
  documentType: 'cnpj',
  document: '',
  phone: '',
  email: '',
  password: '',
  city: '',
  state: '',
  segment: '',
};

function digits(value: string) {
  return value.replace(/\D/g, '');
}

function formatPhone(value: string) {
  const d = digits(value).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
  if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
  return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
}

function formatDocument(value: string, type: 'cnpj' | 'cpf') {
  const d = digits(value).slice(0, type === 'cnpj' ? 14 : 11);
  if (type === 'cpf') {
    return d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return d
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export default function AppGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { mode, user, loading, recoveryMode, signIn, signUp, resendConfirmation, resetPassword, updatePassword } = useAuth();
  const [screen, setScreen] = useState<'login' | 'signup'>('login');
  const [step, setStep] = useState<SignupStep>(1);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [form, setForm] = useState<SignUpPayload>(INITIAL_SIGNUP);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const publicPage = pathname === '/' || pathname === '/site';
  if (publicPage) return <>{children}</>;

  if (mode === 'demo') return <>{children}</>;
  if (loading) return <div className="auth-page auth-loading-page"><div className="auth-loading">Carregando Sistema de Cobrança…</div></div>;

  async function finishRecovery(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      setMessage('Use uma senha com pelo menos 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage('As senhas não coincidem.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      setMessage(await updatePassword(newPassword));
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível atualizar a senha.');
    } finally {
      setBusy(false);
    }
  }

  if (recoveryMode) return <div className="auth-page auth-v2">
    <section className="auth-showcase">
      <div className="auth-showcase-inner">
        <div className="auth-logo jp-auth-logo">
          <img src="/jp-sistema-cobranca-logo.svg" alt="JP Sistema de Cobrança"/>
          <span>Recuperação segura de acesso</span>
        </div>
        <div className="auth-pitch">
          <span className="auth-kicker">SEGURANÇA DA CONTA</span>
          <h2>Crie uma nova senha para continuar.</h2>
          <p>Use uma senha exclusiva, com pelo menos 8 caracteres, e evite reutilizar senhas de outros serviços.</p>
        </div>
        <div className="auth-trust"><ShieldCheck size={18}/><span>O link de recuperação é temporário e protegido pelo Supabase Auth.</span></div>
      </div>
    </section>
    <section className="auth-form-side">
      <form className="auth-card auth-card-v2" onSubmit={finishRecovery}>
        <div className="auth-heading">
          <div className="auth-icon"><LockKeyhole size={21}/></div>
          <div><h1>Defina sua nova senha</h1><p>Depois da alteração, seu acesso será liberado novamente.</p></div>
        </div>
        <label>Nova senha
          <div className="password-field">
            <input type={showPassword?'text':'password'} value={newPassword} onChange={e=>setNewPassword(e.target.value)} minLength={8} required/>
            <button type="button" onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button>
          </div>
        </label>
        <label>Confirmar nova senha
          <input type={showPassword?'text':'password'} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} minLength={8} required/>
        </label>
        {message&&<div className="auth-message">{message}</div>}
        <button className="auth-primary" disabled={busy}>{busy?'Atualizando...':'Salvar nova senha'}</button>
      </form>
    </section>
  </div>;

  if (user) return <>{children}</>;

  function setField<K extends keyof SignUpPayload>(key: K, value: SignUpPayload[K]) {
    setForm(current => ({ ...current, [key]: value }));
  }

  function validateStep() {
    if (step === 1) {
      if (!form.contactName.trim()) return 'Informe o nome do responsável.';
      if (!/\S+@\S+\.\S+/.test(form.email)) return 'Informe um e-mail válido.';
      if (digits(form.phone).length < 10) return 'Informe um telefone com DDD.';
      if (form.password.length < 6) return 'A senha precisa ter pelo menos 6 caracteres.';
    }
    if (step === 2) {
      if (!form.companyName.trim()) return 'Informe o nome da empresa.';
      if (!form.legalName.trim()) return 'Informe a razão social ou nome completo.';
      const expected = form.documentType === 'cnpj' ? 14 : 11;
      if (digits(form.document).length !== expected) return 'Informe um ' + form.documentType.toUpperCase() + ' válido.';
    }
    if (step === 3) {
      if (!form.segment.trim()) return 'Informe o segmento da empresa.';
      if (!form.city.trim()) return 'Informe a cidade.';
      if (form.state.trim().length !== 2) return 'Informe a UF com 2 letras.';
    }
    return '';
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await signIn(loginEmail, loginPassword);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    const error = validateStep();
    if (error) {
      setMessage(error);
      return;
    }
    if (step < 3) {
      setMessage('');
      setStep((step + 1) as SignupStep);
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      setMessage(await signUp({
        ...form,
        phone: digits(form.phone),
        document: digits(form.document),
        state: form.state.toUpperCase(),
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível criar a conta.');
    } finally {
      setBusy(false);
    }
  }

  async function forgotPassword() {
    setBusy(true);
    setMessage('');
    try {
      setMessage(await resetPassword(loginEmail));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível enviar a recuperação.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setMessage('');
    try {
      setMessage(await resendConfirmation(loginEmail || form.email));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível reenviar a confirmação.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="auth-page auth-v2">
    <section className="auth-showcase">
      <div className="auth-showcase-inner">
        <div className="auth-logo jp-auth-logo">
          <img src="/jp-sistema-cobranca-logo.svg" alt="JP Sistema de Cobrança"/>
          <span>Gestão financeira para empresas</span>
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
      <div className="auth-mobile-logo jp-mobile-logo">
        <img src="/jp-sistema-cobranca-logo.svg" alt="JP Sistema de Cobrança"/>
      </div>

      {screen === 'login' ? <form className="auth-card auth-card-v2" onSubmit={handleLogin}>
        <div className="auth-heading">
          <div className="auth-icon"><LockKeyhole size={21}/></div>
          <div>
            <h1>Acesse sua conta</h1>
            <p>Entre com seus dados para acessar sua empresa.</p>
          </div>
        </div>

        <label>E-mail
          <input type="email" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} autoComplete="email" required/>
        </label>

        <label>Senha
          <div className="password-field">
            <input type={showPassword?'text':'password'} value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} autoComplete="current-password" required/>
            <button type="button" onClick={()=>setShowPassword(!showPassword)} aria-label={showPassword?'Ocultar senha':'Mostrar senha'}>
              {showPassword?<EyeOff size={18}/>:<Eye size={18}/>}
            </button>
          </div>
        </label>

        <button type="button" className="auth-forgot" onClick={forgotPassword} disabled={busy||!loginEmail}>Esqueci minha senha</button>

        {message&&<div className="auth-message">{message}</div>}

        <button className="auth-primary" disabled={busy}>{busy?'Entrando...':'Entrar'}</button>

        <div className="auth-divider"><span>ou</span></div>

        <div className="auth-account-switch">
          <span>Primeira vez por aqui?</span>
          <button type="button" onClick={()=>{setScreen('signup');setStep(1);setMessage('')}}>Crie sua conta</button>
        </div>

        <button type="button" className="auth-resend" onClick={resend} disabled={busy||!loginEmail}>Reenviar e-mail de confirmação</button>

        <p className="auth-terms">Ao continuar, você concorda com os termos de uso e política de privacidade da plataforma.</p>
      </form> : <form className="auth-card auth-card-v2 auth-signup-v2" onSubmit={handleSignup}>
        <div className="auth-heading">
          <button type="button" className="auth-back-icon" onClick={()=>{if(step===1){setScreen('login');setMessage('')}else{setStep((step-1) as SignupStep);setMessage('')}}}><ArrowLeft size={18}/></button>
          <div>
            <h1>Crie sua conta</h1>
            <p>Comece com 4 dias grátis. O cadastro leva poucos minutos.</p>
          </div>
        </div>

        <div className="auth-stepper-v2">
          {[1,2,3].map(n=><div key={n} className={'auth-step-v2 '+(step===n?'active ':'')+(step>n?'done':'')}>
            <span>{n}</span><small>{n===1?'Acesso':n===2?'Empresa':'Detalhes'}</small>
          </div>)}
        </div>

        {step===1&&<>
          <label>Nome do responsável<input value={form.contactName} onChange={e=>setField('contactName',e.target.value)} required/></label>
          <label>E-mail<input type="email" value={form.email} onChange={e=>setField('email',e.target.value)} required/></label>
          <label>Telefone / WhatsApp
            <div className="auth-input-icon-v2"><Phone size={17}/><input value={form.phone} onChange={e=>setField('phone',formatPhone(e.target.value))} placeholder="(41) 99999-9999" required/></div>
          </label>
          <label>Senha
            <div className="password-field">
              <input type={showPassword?'text':'password'} minLength={6} value={form.password} onChange={e=>setField('password',e.target.value)} required/>
              <button type="button" onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button>
            </div>
          </label>
        </>}

        {step===2&&<>
          <label>Nome da empresa<input value={form.companyName} onChange={e=>setField('companyName',e.target.value)} required/></label>
          <label>Razão social / nome completo<input value={form.legalName} onChange={e=>setField('legalName',e.target.value)} required/></label>
          <div className="auth-cols-v2">
            <label>Tipo
              <select value={form.documentType} onChange={e=>{const type=e.target.value as 'cnpj'|'cpf';setField('documentType',type);setField('document','')}}>
                <option value="cnpj">CNPJ</option><option value="cpf">CPF</option>
              </select>
            </label>
            <label>{form.documentType.toUpperCase()}
              <input value={form.document} onChange={e=>setField('document',formatDocument(e.target.value,form.documentType))} placeholder={form.documentType==='cnpj'?'00.000.000/0000-00':'000.000.000-00'} required/>
            </label>
          </div>
        </>}

        {step===3&&<>
          <label>Segmento<input value={form.segment} onChange={e=>setField('segment',e.target.value)} placeholder="Ex.: serviços, escola, varejo" required/></label>
          <div className="auth-cols-v2">
            <label>Cidade<input value={form.city} onChange={e=>setField('city',e.target.value)} required/></label>
            <label>UF<input value={form.state} onChange={e=>setField('state',e.target.value.toUpperCase().slice(0,2))} maxLength={2} required/></label>
          </div>
          <div className="auth-signup-benefits-v2">
            <div><CheckCircle2 size={15}/> 4 dias grátis</div>
            <div><ShieldCheck size={15}/> Dados separados por empresa</div>
          </div>
        </>}

        {message&&<div className="auth-message">{message}</div>}

        <button className="auth-primary" disabled={busy}>{busy?'Processando...':step<3?'Continuar':'Criar conta grátis'}</button>
      </form>}
    </section>
  </div>;
}
