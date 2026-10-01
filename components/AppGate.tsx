'use client';

import { useState } from 'react';
import {
  ArrowLeft, ArrowRight, Building2, CheckCircle2, CreditCard,
  Eye, EyeOff, Mail, Phone, ShieldCheck, WalletCards
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
  if (d.length <= 6) return '(' + d.slice(0,2) + ') ' + d.slice(2);
  if (d.length <= 10) return '(' + d.slice(0,2) + ') ' + d.slice(2,6) + '-' + d.slice(6);
  return '(' + d.slice(0,2) + ') ' + d.slice(2,7) + '-' + d.slice(7);
}

function formatDocument(value: string, type: 'cnpj' | 'cpf') {
  const d = digits(value).slice(0, type === 'cnpj' ? 14 : 11);
  if (type === 'cpf') {
    return d.replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2');
  }
  return d.replace(/(\d{2})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1/$2').replace(/(\d{4})(\d{1,2})$/,'$1-$2');
}

export default function AppGate({ children }: { children: React.ReactNode }) {
  const { mode, user, loading, signIn, signUp, resendConfirmation, resetPassword } = useAuth();
  const [screen, setScreen] = useState<'login' | 'signup'>('login');
  const [step, setStep] = useState<SignupStep>(1);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [form, setForm] = useState<SignUpPayload>(INITIAL_SIGNUP);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  if (mode === 'demo') return <>{children}</>;
  if (loading) return <div className="fin-auth-loading">Carregando Sistema de Cobrança…</div>;
  if (user) return <>{children}</>;

  function setField<K extends keyof SignUpPayload>(key: K, value: SignUpPayload[K]) {
    setForm(current => ({ ...current, [key]: value }));
  }

  function validateCurrentStep() {
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

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMessage('');
    try {
      await signIn(loginEmail, loginPassword);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }

  async function signup(e: React.FormEvent) {
    e.preventDefault();
    const validation = validateCurrentStep();
    if (validation) {
      setMessage(validation);
      return;
    }
    if (step < 3) {
      setMessage('');
      setStep((step + 1) as SignupStep);
      return;
    }
    setBusy(true); setMessage('');
    try {
      const text = await signUp({
        ...form,
        phone: digits(form.phone),
        document: digits(form.document),
        state: form.state.toUpperCase(),
      });
      setMessage(text);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível criar a conta.');
    } finally {
      setBusy(false);
    }
  }

  async function forgotPassword() {
    setBusy(true); setMessage('');
    try {
      setMessage(await resetPassword(loginEmail));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível enviar a recuperação.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    const targetEmail = loginEmail || form.email;
    setBusy(true); setMessage('');
    try {
      setMessage(await resendConfirmation(targetEmail));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível reenviar a confirmação.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="fin-auth-page">
    <section className="fin-auth-showcase">
      <div className="fin-showcase-card">
        <div className="fin-showcase-title">
          <span>Sistema de Cobrança</span>
          <small>Gestão financeira para empresas</small>
        </div>

        <div className="fin-showcase-copy">
          <h2>Cobranças simples para sua empresa crescer.</h2>
          <p>Cadastre clientes, acompanhe recebimentos e organize sua operação financeira em um único lugar.</p>
        </div>

        <div className="fin-orb-area">
          <div className="fin-orb"></div>
          <div className="fin-float fin-float-one"><CreditCard size={16}/> Boletos</div>
          <div className="fin-float fin-float-two"><WalletCards size={16}/> Assinaturas</div>
          <div className="fin-float fin-float-three"><Building2 size={16}/> Empresas</div>
          <div className="fin-message"><Mail size={16}/> Tenha seu financeiro organizado e acessível.</div>
        </div>
      </div>
    </section>

    <section className="fin-auth-main">
      <div className="fin-auth-box">
        <div className="fin-brand">
          <div className="brand-mark"><WalletCards size={22}/></div>
          <strong>Sistema de Cobrança</strong>
        </div>

        {screen === 'login' ? <form className="fin-form" onSubmit={login}>
          <div className="fin-form-head">
            <h1>Acesse sua conta</h1>
            <p>Entre com seus dados para acessar sua empresa.</p>
          </div>

          <label>E-mail
            <input type="email" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} placeholder="seuemail@empresa.com.br" required/>
          </label>

          <label>Senha
            <div className="fin-password">
              <input type={showPassword?'text':'password'} value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} placeholder="Digite sua senha" required/>
              <button type="button" onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button>
            </div>
          </label>

          <button type="button" className="fin-link fin-forgot" onClick={forgotPassword} disabled={busy||!loginEmail}>Esqueci minha senha</button>

          {message&&<div className="auth-message">{message}</div>}

          <button className="fin-primary" disabled={busy}>{busy?'Entrando...':'Acessar conta'}</button>

          <div className="fin-account-switch">Primeira vez por aqui? <button type="button" onClick={()=>{setScreen('signup');setStep(1);setMessage('')}}>Crie sua conta</button></div>
          <button type="button" className="fin-link fin-resend" onClick={resend} disabled={busy||!loginEmail}>Reenviar e-mail de confirmação</button>
        </form> : <form className="fin-form fin-signup" onSubmit={signup}>
          <div className="fin-form-head">
            <h1>Crie sua conta</h1>
            <p>Comece com 4 dias grátis e escolha seu plano depois.</p>
          </div>

          <div className="fin-stepper">
            {[1,2,3].map(n=><div className={'fin-step '+(step===n?'active ':'')+(step>n?'done':'')} key={n}>
              <span>{n}</span><small>{n===1?'Acesso':n===2?'Empresa':'Detalhes'}</small>
            </div>)}
          </div>

          {step===1&&<>
            <label>Nome do responsável
              <input value={form.contactName} onChange={e=>setField('contactName',e.target.value)} placeholder="Seu nome completo" required/>
            </label>
            <label>E-mail
              <input type="email" value={form.email} onChange={e=>setField('email',e.target.value)} placeholder="financeiro@empresa.com.br" required/>
            </label>
            <label>Telefone / WhatsApp
              <div className="fin-icon-input"><Phone size={17}/><input value={form.phone} onChange={e=>setField('phone',formatPhone(e.target.value))} placeholder="(41) 99999-9999" required/></div>
            </label>
            <label>Senha
              <div className="fin-password">
                <input type={showPassword?'text':'password'} minLength={6} value={form.password} onChange={e=>setField('password',e.target.value)} placeholder="Mínimo de 6 caracteres" required/>
                <button type="button" onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button>
              </div>
            </label>
          </>}

          {step===2&&<>
            <label>Nome da empresa
              <input value={form.companyName} onChange={e=>setField('companyName',e.target.value)} placeholder="Nome fantasia" required/>
            </label>
            <label>Razão social / nome completo
              <input value={form.legalName} onChange={e=>setField('legalName',e.target.value)} placeholder="Razão social da empresa" required/>
            </label>
            <div className="fin-two-cols">
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
            <label>Segmento
              <input value={form.segment} onChange={e=>setField('segment',e.target.value)} placeholder="Ex.: serviços, escola, varejo" required/>
            </label>
            <div className="fin-two-cols">
              <label>Cidade
                <input value={form.city} onChange={e=>setField('city',e.target.value)} placeholder="Cidade" required/>
              </label>
              <label>UF
                <input value={form.state} onChange={e=>setField('state',e.target.value.toUpperCase().slice(0,2))} placeholder="PR" maxLength={2} required/>
              </label>
            </div>
            <div className="fin-signup-benefits">
              <div><CheckCircle2 size={16}/> 4 dias grátis</div>
              <div><ShieldCheck size={16}/> Dados separados por empresa</div>
              <div><ArrowRight size={16}/> Escolha do plano após o teste</div>
            </div>
          </>}

          {message&&<div className="auth-message">{message}</div>}

          <div className="fin-signup-actions">
            <button type="button" className="fin-back" onClick={()=>{if(step===1){setScreen('login');setMessage('')}else{setStep((step-1) as SignupStep);setMessage('')}}}><ArrowLeft size={15}/>{step===1?'Voltar ao login':'Voltar'}</button>
            <button className="fin-primary" disabled={busy}>{busy?'Processando...':step<3?'Continuar':'Criar conta grátis'}</button>
          </div>
        </form>}
      </div>
    </section>
  </div>;
}
