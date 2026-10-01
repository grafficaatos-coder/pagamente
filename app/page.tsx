'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Building2, CalendarClock, Crown, LayoutDashboard, LogOut, Plus,
  ReceiptText, RefreshCw, Settings, UserCircle2, UsersRound, WalletCards
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { brl, dateBR, parseBRL } from '@/lib/format';

type Client = {
  id: string;
  name: string;
  document: string | null;
  email: string | null;
  whatsapp: string | null;
};

type Charge = {
  id: string;
  description: string;
  amount_cents: number;
  due_date: string;
  status: string;
  clients?: { name?: string } | null;
};

type RecurringRule = {
  id: string;
  description: string;
  amount_cents: number;
  frequency: string;
  generation_day: number;
  due_day: number;
  status: string;
  clients?: { name?: string } | null;
};

type PlatformOrg = {
  id: string;
  name: string;
  status: string;
  created_at: string;
  plan?: string;
  subscriptionStatus?: string;
  trialEndsAt?: string;
};

type TenantTab = 'inicio' | 'clientes' | 'cobrancas' | 'recorrencias' | 'relatorios' | 'assinatura' | 'conta';

const statusLabel: Record<string, string> = {
  active: 'Ativo',
  trialing: 'Em teste',
  pending: 'Pendente',
  draft: 'Rascunho',
  paid: 'Pago',
  overdue: 'Em atraso',
  cancelled: 'Cancelado',
  failed: 'Falhou',
  past_due: 'Pagamento pendente',
  suspended: 'Suspenso',
  paused: 'Pausado',
};

const frequencyLabel: Record<string, string> = {
  biweekly: 'Quinzenal',
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  annual: 'Anual',
};

export default function Home() {
  const { user, signOut } = useAuth();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [org, setOrg] = useState<any>(null);
  const [wallet, setWallet] = useState<any>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [recurring, setRecurring] = useState<RecurringRule[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [membership, setMembership] = useState<any>(null);
  const [subscription, setSubscription] = useState<any>(null);
  const [platformOrgs, setPlatformOrgs] = useState<PlatformOrg[]>([]);
  const [tab, setTab] = useState<TenantTab>('inicio');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const [clientForm, setClientForm] = useState({
    name: '',
    document: '',
    email: '',
    whatsapp: '',
  });

  const [chargeForm, setChargeForm] = useState({
    clientId: '',
    description: '',
    amount: '',
    dueDate: '',
  });

  const [recurringForm, setRecurringForm] = useState({
    clientId: '',
    description: '',
    amount: '',
    frequency: 'monthly',
    generationDay: '1',
    dueDay: '10',
  });

  async function load() {
    if (!supabase || !user) return;
    setBusy(true);
    setMsg('');

    try {
      const { data: p, error: pe } = await supabase
        .from('profiles')
        .select('display_name,is_platform_admin')
        .eq('id', user.id)
        .maybeSingle();

      if (pe) throw pe;
      setProfile(p);

      const { data: member, error: memberError } = await supabase
        .from('organization_members')
        .select('organization_id,role')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();

      if (memberError) throw memberError;
      setMembership(member);

      if (member) {
        const orgId = member.organization_id;

        const [
          { data: o, error: oe },
          { data: w, error: we },
          { data: c, error: ce },
          { data: ch, error: che },
          { data: rr, error: rre },
          { data: sub, error: se },
        ] = await Promise.all([
          supabase.from('organizations').select('id,name,status').eq('id', orgId).single(),
          supabase.from('wallet_accounts').select('id,account_number,pix_key,balance_cents').eq('organization_id', orgId).single(),
          supabase.from('clients').select('id,name,document,email,whatsapp').eq('organization_id', orgId).order('created_at', { ascending: false }),
          supabase.from('charges').select('id,description,amount_cents,due_date,status,clients(name)').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(100),
          supabase.from('recurring_rules').select('id,description,amount_cents,frequency,generation_day,due_day,status,clients(name)').eq('organization_id', orgId).order('created_at', { ascending: false }),
          supabase.from('subscriptions').select('status,trial_ends_at,current_period_end,plans(name,monthly_price_cents)').eq('organization_id', orgId).maybeSingle(),
        ]);

        if (oe || we || ce || che || rre || se) throw oe || we || ce || che || rre || se;

        setOrg(o);
        setWallet(w);
        setClients(c ?? []);
        setCharges((ch ?? []) as any);
        setRecurring((rr ?? []) as any);
        setSubscription(sub);

        if (!chargeForm.clientId && c?.[0]?.id) {
          setChargeForm((f) => ({ ...f, clientId: c[0].id }));
        }
        if (!recurringForm.clientId && c?.[0]?.id) {
          setRecurringForm((f) => ({ ...f, clientId: c[0].id }));
        }
      } else if (!p?.is_platform_admin) {
        setMsg('Nenhuma empresa vinculada a este usuário.');
      }

      if (p?.is_platform_admin) {
        const [
          { data: orgs, error: orgsError },
          { data: subs, error: subsError },
        ] = await Promise.all([
          supabase.from('organizations').select('id,name,status,created_at').order('created_at', { ascending: false }).limit(100),
          supabase.from('subscriptions').select('organization_id,status,trial_ends_at,plans(name)').limit(100),
        ]);

        if (orgsError || subsError) throw orgsError || subsError;

        const subscriptionByOrg = new Map((subs ?? []).map((s: any) => [s.organization_id, s]));

        setPlatformOrgs((orgs ?? []).map((item: any) => {
          const sub: any = subscriptionByOrg.get(item.id);
          const plan = Array.isArray(sub?.plans) ? sub?.plans?.[0]?.name : sub?.plans?.name;

          return {
            ...item,
            plan: plan ?? '—',
            subscriptionStatus: sub?.status ?? '—',
            trialEndsAt: sub?.trial_ends_at,
          };
        }));
      } else {
        setPlatformOrgs([]);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erro ao carregar dados.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, [user?.id]);

  async function addClient(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !org) return;

    setBusy(true);
    setMsg('');

    const { error } = await supabase.from('clients').insert({
      organization_id: org.id,
      ...clientForm,
      status: 'active',
    });

    if (error) {
      setMsg(error.message);
    } else {
      setClientForm({ name: '', document: '', email: '', whatsapp: '' });
      setMsg('Cliente cadastrado com sucesso.');
      await load();
      setTab('clientes');
    }

    setBusy(false);
  }

  async function addCharge(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !org) return;

    const amount = parseBRL(chargeForm.amount);
    if (amount <= 0) {
      setMsg('Informe um valor válido.');
      return;
    }

    setBusy(true);
    setMsg('');

    const { error } = await supabase.from('charges').insert({
      organization_id: org.id,
      client_id: chargeForm.clientId,
      description: chargeForm.description,
      amount_cents: amount,
      due_date: chargeForm.dueDate,
      provider: 'mock',
      status: 'pending',
      send_email: false,
      send_whatsapp: false,
    });

    if (error) {
      setMsg(error.message);
    } else {
      setChargeForm((f) => ({ ...f, description: '', amount: '', dueDate: '' }));
      setMsg('Cobrança criada com sucesso.');
      await load();
      setTab('cobrancas');
    }

    setBusy(false);
  }

  async function addRecurring(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !org) return;

    const amount = parseBRL(recurringForm.amount);
    if (amount <= 0) {
      setMsg('Informe um valor válido.');
      return;
    }

    setBusy(true);
    setMsg('');

    const { error } = await supabase.from('recurring_rules').insert({
      organization_id: org.id,
      client_id: recurringForm.clientId,
      description: recurringForm.description,
      amount_cents: amount,
      frequency: recurringForm.frequency,
      generation_day: Number(recurringForm.generationDay),
      due_day: Number(recurringForm.dueDay),
      provider: 'mock',
      status: 'active',
      send_email: false,
      send_whatsapp: false,
    });

    if (error) {
      setMsg(error.message);
    } else {
      setRecurringForm((f) => ({
        ...f,
        description: '',
        amount: '',
      }));
      setMsg('Cobrança recorrente criada com sucesso.');
      await load();
      setTab('recorrencias');
    }

    setBusy(false);
  }

  const openCharges = charges.filter((c) => ['pending', 'draft', 'overdue'].includes(c.status));
  const open = openCharges.reduce((sum, c) => sum + Number(c.amount_cents), 0);
  const paid = charges.filter((c) => c.status === 'paid').reduce((sum, c) => sum + Number(c.amount_cents), 0);
  const overdue = charges.filter((c) => c.status === 'overdue').reduce((sum, c) => sum + Number(c.amount_cents), 0);
  const activeOrgs = platformOrgs.filter((o) => ['active', 'trialing'].includes(o.status)).length;
  const planName = Array.isArray(subscription?.plans) ? subscription?.plans?.[0]?.name : subscription?.plans?.name;
  const planPrice = Array.isArray(subscription?.plans) ? subscription?.plans?.[0]?.monthly_price_cents : subscription?.plans?.monthly_price_cents;

  if (profile?.is_platform_admin) {
    return <div className="app owner-app">
      <header>
        <div className="brand"><WalletCards size={24}/><strong>Sistema de Cobrança</strong></div>
        <div className="user">
          <span className="owner-chip"><Crown size={13}/> Dono da plataforma</span>
          {profile?.display_name ?? user?.email}
          <button onClick={load} title="Atualizar"><RefreshCw size={17}/></button>
          <button onClick={() => signOut()} title="Sair"><LogOut size={17}/></button>
        </div>
      </header>

      <main>
        <div className="heading">
          <div>
            <h1>Painel do proprietário</h1>
            <p>Visão administrativa de todas as empresas da plataforma.</p>
          </div>
          <span className="badge">proprietário</span>
        </div>

        {msg && <div className="notice">{msg}</div>}

        <section className="owner-panel">
          <div className="owner-title">
            <div><Crown size={20}/><strong>Administração da plataforma</strong></div>
            <span>Acesso exclusivo do dono</span>
          </div>

          <div className="metrics owner-metrics">
            <div className="metric primary">
              <span>Empresas cadastradas</span>
              <strong>{platformOrgs.length}</strong>
              <small>total na plataforma</small>
            </div>
            <div className="metric">
              <span>Ativas / teste</span>
              <strong>{activeOrgs}</strong>
              <small>empresas operando</small>
            </div>
            <div className="metric">
              <span>Assinaturas</span>
              <strong>{platformOrgs.filter((o) => o.subscriptionStatus !== '—').length}</strong>
              <small>registros de assinatura</small>
            </div>
          </div>

          <div className="card tableCard owner-table">
            <div className="cardHead">
              <div>
                <h2>Empresas da plataforma</h2>
                <p>Contas cadastradas no Sistema de Cobrança</p>
              </div>
            </div>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr><th>Empresa</th><th>Status</th><th>Plano</th><th>Assinatura</th><th>Teste até</th></tr>
                </thead>
                <tbody>
                  {platformOrgs.map((o) => <tr key={o.id}>
                    <td><strong>{o.name}</strong></td>
                    <td><span className={'status ' + o.status}>{statusLabel[o.status] ?? o.status}</span></td>
                    <td>{o.plan ?? '—'}</td>
                    <td>{statusLabel[o.subscriptionStatus ?? ''] ?? o.subscriptionStatus ?? '—'}</td>
                    <td>{o.trialEndsAt ? dateBR(o.trialEndsAt) : '—'}</td>
                  </tr>)}
                  {!platformOrgs.length && <tr><td colSpan={5} className="empty">{busy ? 'Carregando…' : 'Nenhuma empresa encontrada.'}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>;
  }

  const nav = [
    ['inicio', 'Início', LayoutDashboard],
    ['clientes', 'Clientes', UsersRound],
    ['cobrancas', 'Cobranças', ReceiptText],
    ['recorrencias', 'Recorrências', CalendarClock],
    ['relatorios', 'Relatórios', BarChart3],
    ['assinatura', 'Assinatura', WalletCards],
    ['conta', 'Minha conta', UserCircle2],
  ] as const;

  return <div className="tenant-shell">
    <aside className="tenant-sidebar">
      <div className="tenant-brand">
        <div className="brand-mark"><WalletCards size={21}/></div>
        <div><strong>Sistema de Cobrança</strong><span>Área do cliente</span></div>
      </div>

      <div className="company-card">
        <Building2 size={18}/>
        <div>
          <strong>{org?.name ?? 'Sua empresa'}</strong>
          <span>{planName ? 'Plano ' + planName : 'Conta empresarial'}</span>
        </div>
      </div>

      <nav className="tenant-nav">
        {nav.map(([id, label, Icon]) =>
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            <Icon size={18}/><span>{label}</span>
          </button>
        )}
      </nav>

      <div className="tenant-side-bottom">
        <div className="tenant-user">
          <div className="avatar">{(profile?.display_name?.[0] ?? user?.email?.[0] ?? 'U').toUpperCase()}</div>
          <div>
            <strong>{profile?.display_name ?? 'Usuário'}</strong>
            <span>{membership?.role === 'owner' ? 'Administrador da empresa' : membership?.role === 'admin' ? 'Gestor' : 'Usuário'}</span>
          </div>
        </div>
        <button className="tenant-logout" onClick={() => signOut()}><LogOut size={17}/> Sair</button>
      </div>
    </aside>

    <section className="tenant-main">
      <header className="tenant-topbar">
        <div><strong>{org?.name ?? 'Minha empresa'}</strong><span>{user?.email}</span></div>
        <button onClick={load} title="Atualizar"><RefreshCw size={17}/></button>
      </header>

      <main className="tenant-content">
        {msg && <div className="notice">{msg}</div>}

        {tab === 'inicio' && <>
          <div className="tenant-heading">
            <div>
              <span className="eyebrow">VISÃO GERAL</span>
              <h1>Olá, {profile?.display_name?.split(' ')?.[0] ?? 'bem-vindo'}!</h1>
              <p>Acompanhe suas cobranças e recebimentos em um só lugar.</p>
            </div>
            <button className="primaryBtn compact" onClick={() => setTab('cobrancas')}><Plus size={16}/> Nova cobrança</button>
          </div>

          <section className="metrics tenant-metrics">
            <div className="metric primary">
              <span>Saldo disponível</span>
              <strong>{brl(Number(wallet?.balance_cents ?? 0))}</strong>
              <small>{wallet?.account_number ?? 'Conta digital'}</small>
            </div>
            <div className="metric">
              <span>A receber</span>
              <strong>{brl(open)}</strong>
              <small>{openCharges.length} cobranças em aberto</small>
            </div>
            <div className="metric">
              <span>Recebido</span>
              <strong>{brl(paid)}</strong>
              <small>cobranças pagas</small>
            </div>
          </section>

          <div className="grid tenant-home-grid">
            <section className="card tableCard">
              <div className="cardHead">
                <div><h2>Cobranças recentes</h2><p>Últimos lançamentos da empresa</p></div>
                <button className="text-action" onClick={() => setTab('cobrancas')}>Ver todas</button>
              </div>
              <div className="tableWrap">
                <table>
                  <thead><tr><th>Cliente</th><th>Vencimento</th><th>Status</th><th>Valor</th></tr></thead>
                  <tbody>
                    {charges.slice(0, 6).map((c) => <tr key={c.id}>
                      <td>{Array.isArray(c.clients) ? c.clients[0]?.name : (c.clients as any)?.name ?? 'Cliente'}</td>
                      <td>{dateBR(c.due_date)}</td>
                      <td><span className={'status ' + c.status}>{statusLabel[c.status] ?? c.status}</span></td>
                      <td>{brl(Number(c.amount_cents))}</td>
                    </tr>)}
                    {!charges.length && <tr><td colSpan={4} className="empty">Nenhuma cobrança cadastrada.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="card summary-card">
              <h2>Resumo da conta</h2>
              <div className="summary-row"><span>Clientes cadastrados</span><strong>{clients.length}</strong></div>
              <div className="summary-row"><span>Em atraso</span><strong>{brl(overdue)}</strong></div>
              <div className="summary-row"><span>Plano atual</span><strong>{planName ?? 'Profissional'}</strong></div>
              <div className="summary-row">
                <span>Status</span>
                <span className={'status ' + (subscription?.status ?? org?.status ?? 'active')}>
                  {statusLabel[subscription?.status ?? org?.status ?? 'active'] ?? 'Ativo'}
                </span>
              </div>
            </section>
          </div>
        </>}

        {tab === 'clientes' && <>
          <div className="tenant-heading">
            <div><span className="eyebrow">CADASTROS</span><h1>Clientes</h1><p>Cadastre e acompanhe os clientes da sua empresa.</p></div>
          </div>

          <div className="grid">
            <section className="card">
              <h2>Novo cliente</h2>
              <form onSubmit={addClient}>
                <label>Nome / Razão social<input required value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}/></label>
                <label>CPF / CNPJ<input value={clientForm.document} onChange={(e) => setClientForm({ ...clientForm, document: e.target.value })}/></label>
                <div className="cols">
                  <label>E-mail<input type="email" value={clientForm.email} onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })}/></label>
                  <label>WhatsApp<input value={clientForm.whatsapp} onChange={(e) => setClientForm({ ...clientForm, whatsapp: e.target.value })}/></label>
                </div>
                <button className="primaryBtn" disabled={busy}><Plus size={16}/> Cadastrar cliente</button>
              </form>
            </section>

            <section className="card info-card">
              <UsersRound size={26}/>
              <h2>{clients.length} clientes cadastrados</h2>
              <p>Os dados ficam separados por empresa. Cada cliente da plataforma visualiza somente os próprios registros.</p>
            </section>
          </div>

          <section className="card tableCard">
            <div className="cardHead"><div><h2>Lista de clientes</h2><p>Contatos cadastrados</p></div></div>
            <div className="tableWrap">
              <table>
                <thead><tr><th>Nome</th><th>Documento</th><th>E-mail</th><th>WhatsApp</th></tr></thead>
                <tbody>
                  {clients.map((c) => <tr key={c.id}>
                    <td><strong>{c.name}</strong></td><td>{c.document || '—'}</td><td>{c.email || '—'}</td><td>{c.whatsapp || '—'}</td>
                  </tr>)}
                  {!clients.length && <tr><td colSpan={4} className="empty">Nenhum cliente cadastrado.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>}

        {tab === 'cobrancas' && <>
          <div className="tenant-heading">
            <div><span className="eyebrow">FINANCEIRO</span><h1>Cobranças</h1><p>Crie e acompanhe as cobranças da sua empresa.</p></div>
          </div>

          <div className="grid">
            <section className="card">
              <h2>Nova cobrança</h2>
              <form onSubmit={addCharge}>
                <label>Cliente<select required value={chargeForm.clientId} onChange={(e) => setChargeForm({ ...chargeForm, clientId: e.target.value })}>
                  <option value="">Selecione</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></label>
                <label>Descrição<input required value={chargeForm.description} onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })}/></label>
                <div className="cols">
                  <label>Valor<input required placeholder="0,00" value={chargeForm.amount} onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })}/></label>
                  <label>Vencimento<input type="date" required value={chargeForm.dueDate} onChange={(e) => setChargeForm({ ...chargeForm, dueDate: e.target.value })}/></label>
                </div>
                <button className="primaryBtn" disabled={busy || !clients.length}><Plus size={16}/> Criar cobrança</button>
              </form>
            </section>

            <section className="card info-card">
              <ReceiptText size={26}/>
              <h2>{openCharges.length} cobranças em aberto</h2>
              <p>Total previsto para recebimento: <strong>{brl(open)}</strong>.</p>
            </section>
          </div>

          <section className="card tableCard">
            <div className="cardHead"><div><h2>Todas as cobranças</h2><p>Histórico financeiro da empresa</p></div></div>
            <div className="tableWrap">
              <table>
                <thead><tr><th>Cliente</th><th>Descrição</th><th>Vencimento</th><th>Status</th><th>Valor</th></tr></thead>
                <tbody>
                  {charges.map((c) => <tr key={c.id}>
                    <td>{Array.isArray(c.clients) ? c.clients[0]?.name : (c.clients as any)?.name ?? 'Cliente'}</td>
                    <td>{c.description}</td><td>{dateBR(c.due_date)}</td>
                    <td><span className={'status ' + c.status}>{statusLabel[c.status] ?? c.status}</span></td>
                    <td>{brl(Number(c.amount_cents))}</td>
                  </tr>)}
                  {!charges.length && <tr><td colSpan={5} className="empty">Nenhuma cobrança cadastrada.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>}

        {tab === 'recorrencias' && <>
          <div className="tenant-heading">
            <div><span className="eyebrow">AUTOMAÇÃO</span><h1>Recorrências</h1><p>Cadastre cobranças que se repetem automaticamente.</p></div>
          </div>

          <div className="grid">
            <section className="card">
              <h2>Nova recorrência</h2>
              <form onSubmit={addRecurring}>
                <label>Cliente<select required value={recurringForm.clientId} onChange={(e) => setRecurringForm({ ...recurringForm, clientId: e.target.value })}>
                  <option value="">Selecione</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></label>
                <label>Descrição<input required value={recurringForm.description} onChange={(e) => setRecurringForm({ ...recurringForm, description: e.target.value })}/></label>
                <div className="cols">
                  <label>Valor<input required placeholder="0,00" value={recurringForm.amount} onChange={(e) => setRecurringForm({ ...recurringForm, amount: e.target.value })}/></label>
                  <label>Frequência<select value={recurringForm.frequency} onChange={(e) => setRecurringForm({ ...recurringForm, frequency: e.target.value })}>
                    <option value="monthly">Mensal</option>
                    <option value="biweekly">Quinzenal</option>
                    <option value="quarterly">Trimestral</option>
                    <option value="annual">Anual</option>
                  </select></label>
                </div>
                <div className="cols">
                  <label>Dia de geração<input type="number" min="1" max="28" value={recurringForm.generationDay} onChange={(e) => setRecurringForm({ ...recurringForm, generationDay: e.target.value })}/></label>
                  <label>Dia do vencimento<input type="number" min="1" max="28" value={recurringForm.dueDay} onChange={(e) => setRecurringForm({ ...recurringForm, dueDay: e.target.value })}/></label>
                </div>
                <button className="primaryBtn" disabled={busy || !clients.length}><Plus size={16}/> Criar recorrência</button>
              </form>
            </section>

            <section className="card info-card">
              <CalendarClock size={26}/>
              <h2>{recurring.filter((r) => r.status === 'active').length} recorrências ativas</h2>
              <p>Use recorrências para mensalidades, contratos e cobranças periódicas.</p>
            </section>
          </div>

          <section className="card tableCard">
            <div className="cardHead"><div><h2>Cobranças recorrentes</h2><p>Regras cadastradas</p></div></div>
            <div className="tableWrap">
              <table>
                <thead><tr><th>Cliente</th><th>Descrição</th><th>Frequência</th><th>Vencimento</th><th>Status</th><th>Valor</th></tr></thead>
                <tbody>
                  {recurring.map((r) => <tr key={r.id}>
                    <td>{Array.isArray(r.clients) ? r.clients[0]?.name : (r.clients as any)?.name ?? 'Cliente'}</td>
                    <td>{r.description}</td><td>{frequencyLabel[r.frequency] ?? r.frequency}</td><td>Dia {r.due_day}</td>
                    <td><span className={'status ' + r.status}>{statusLabel[r.status] ?? r.status}</span></td>
                    <td>{brl(Number(r.amount_cents))}</td>
                  </tr>)}
                  {!recurring.length && <tr><td colSpan={6} className="empty">Nenhuma recorrência cadastrada.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>}

        {tab === 'relatorios' && <>
          <div className="tenant-heading">
            <div><span className="eyebrow">ANÁLISE</span><h1>Relatórios</h1><p>Resumo dos principais números da sua empresa.</p></div>
          </div>

          <section className="metrics">
            <div className="metric"><span>Total recebido</span><strong>{brl(paid)}</strong><small>cobranças pagas</small></div>
            <div className="metric"><span>Em aberto</span><strong>{brl(open)}</strong><small>aguardando pagamento</small></div>
            <div className="metric"><span>Em atraso</span><strong>{brl(overdue)}</strong><small>requer atenção</small></div>
          </section>

          <section className="card report-placeholder">
            <BarChart3 size={34}/>
            <h2>Relatório financeiro</h2>
            <p>Os indicadores acima são calculados com os dados reais da sua empresa. Gráficos detalhados e exportação podem ser adicionados na próxima etapa.</p>
          </section>
        </>}

        {tab === 'assinatura' && <>
          <div className="tenant-heading">
            <div><span className="eyebrow">PLANO</span><h1>Assinatura</h1><p>Acompanhe seu plano e período de teste.</p></div>
          </div>

          <div className="subscription-card">
            <div>
              <span className="eyebrow">PLANO ATUAL</span>
              <h2>{planName ?? 'Profissional'}</h2>
              <p>{subscription?.status === 'trialing' ? 'Seu período de teste está ativo.' : 'Sua assinatura está ativa na plataforma.'}</p>
            </div>
            <div className="subscription-price">{typeof planPrice === 'number' ? brl(planPrice) : brl(9900)}<span>/mês</span></div>
          </div>

          <div className="grid">
            <section className="card">
              <h2>Status da assinatura</h2>
              <div className="summary-row"><span>Status</span><span className={'status ' + (subscription?.status ?? 'trialing')}>{statusLabel[subscription?.status ?? 'trialing'] ?? subscription?.status}</span></div>
              <div className="summary-row"><span>Teste até</span><strong>{subscription?.trial_ends_at ? dateBR(subscription.trial_ends_at) : '—'}</strong></div>
              <div className="summary-row"><span>Próximo período</span><strong>{subscription?.current_period_end ? dateBR(subscription.current_period_end) : '—'}</strong></div>
            </section>

            <section className="card plan-benefits">
              <h2>Incluído no seu acesso</h2>
              <p>✓ Cadastro de clientes</p>
              <p>✓ Cobranças e recorrências</p>
              <p>✓ Relatórios financeiros</p>
              <p>✓ Separação segura dos dados da empresa</p>
            </section>
          </div>
        </>}

        {tab === 'conta' && <>
          <div className="tenant-heading">
            <div><span className="eyebrow">CONTA</span><h1>Minha conta</h1><p>Informações da empresa e do seu acesso.</p></div>
          </div>

          <div className="grid">
            <section className="card account-card">
              <Settings size={24}/>
              <h2>{org?.name}</h2>
              <div className="summary-row"><span>E-mail</span><strong>{user?.email}</strong></div>
              <div className="summary-row"><span>Perfil</span><strong>{membership?.role === 'owner' ? 'Administrador da empresa' : membership?.role === 'admin' ? 'Gestor' : 'Usuário'}</strong></div>
              <div className="summary-row"><span>Plano</span><strong>{planName ?? '—'}</strong></div>
              <div className="summary-row"><span>Status</span><span className={'status ' + (subscription?.status ?? org?.status ?? 'active')}>{statusLabel[subscription?.status ?? org?.status ?? 'active'] ?? 'Ativo'}</span></div>
            </section>

            <section className="card account-card">
              <WalletCards size={24}/>
              <h2>Conta digital</h2>
              <div className="summary-row"><span>Número da conta</span><strong>{wallet?.account_number ?? '—'}</strong></div>
              <div className="summary-row"><span>Chave interna</span><strong>{wallet?.pix_key ?? '—'}</strong></div>
              <div className="summary-row"><span>Saldo</span><strong>{brl(Number(wallet?.balance_cents ?? 0))}</strong></div>
            </section>
          </div>
        </>}
      </main>
    </section>
  </div>;
}
