// Conta digital JP integrada ao BaaS
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, BarChart3, Building2, CalendarClock, CheckCircle2, CircleDollarSign, Clock3, CreditCard, Crown,
  History, Landmark, LayoutDashboard, LogOut, Mail, MessageCircle, PauseCircle, Pencil, PlayCircle, Plus, ReceiptText, RefreshCw,
  Save, Search, Send, Settings, Sparkles, ShieldCheck, TrendingUp, TriangleAlert, Trash2,
  UserCircle2, UserCog, UsersRound, WalletCards, XCircle
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { brl, dateBR, parseBRL } from '@/lib/format';

type Client = {
  id:string; name:string; document:string|null; email:string|null; whatsapp:string|null; status:string;
  delivery_preference?:'manual'|'email'|'whatsapp'|'both';
  address?:{
    zip_code?:string; street_name?:string; street_number?:string; neighborhood?:string; city?:string; state?:string
  }|null
};
type Charge = {
  id:string; description:string; amount_cents:number; due_date:string; status:string;
  provider:string; payment_method?:'boleto'|'pix'|'boleto_pix'|null; provider_charge_id?:string|null; created_at:string; boleto_url?:string|null; digitable_line?:string|null;
  pix_provider_charge_id?:string|null; pix_url?:string|null; pix_code?:string|null;
  clients?:{name?:string;email?:string|null;whatsapp?:string|null}|null
};
type RecurringRule = { id:string; description:string; amount_cents:number; frequency:string; generation_day:number; due_day:number; status:string; clients?:{name?:string}|null };
type TeamMember = { user_id:string; email:string|null; display_name:string|null; role:string; created_at:string };
type OrgInvite = { id:string; email:string; role:string; status:string; created_at:string };
type WalletTransaction = {
  id:string; type:string; direction:'credit'|'debit'; description:string; counterpart:string|null;
  amount_cents:number; reference_id:string|null; created_at:string
};
type WalletTransfer = {
  id:string; recipient_name:string; destination_key:string; description:string; amount_cents:number;
  fee_cents:number; status:string; provider:string; provider_transfer_id:string|null; created_at:string; completed_at:string|null
};
type AuditItem = {
  id:string; organization_id?:string|null; organization_name?:string|null; actor_email?:string|null;
  actor_name?:string|null; action:string; entity_type:string; entity_id?:string|null; created_at:string
};
type OwnerSnapshot = {
  organization:any; subscription:any; counts:any; members:any[]; recent_invoices:any[]; recent_audit:any[]
};

type Plan = {
  id:string;
  code:string;
  name:string;
  billing_model:'monthly'|'per_boleto'|'hybrid';
  monthly_price_cents:number;
  boleto_fee_cents:number;
  max_clients:number|null;
  max_users:number|null;
  active:boolean;
};

type PlatformOrg = {
  id:string;
  name:string;
  status:string;
  created_at:string;
  planId?:string;
  plan?:string;
  subscriptionStatus?:string;
  trialEndsAt?:string;
};

type PlatformInvoice = {
  id:string;
  organization_id:string;
  reference_month:string;
  total_cents:number;
  status:string;
  due_date:string;
  boleto_count:number;
  monthly_fee_cents:number;
  boleto_fee_cents:number;
  organizations?:{name?:string}|null;
  plans?:{name?:string}|null;
};

type TenantTab = 'inicio'|'clientes'|'cobrancas'|'recorrencias'|'conta_digital'|'integracoes'|'equipe'|'atividade'|'relatorios'|'assinatura'|'conta';
type OwnerTab = 'visao'|'empresas'|'planos'|'faturamento'|'auditoria'|'configuracoes';

const statusLabel:Record<string,string> = {
  active:'Ativo', trialing:'Em teste', pending:'Pendente', draft:'Rascunho',
  paid:'Pago', overdue:'Em atraso', cancelled:'Cancelado', failed:'Falhou',
  past_due:'Pagamento pendente', suspended:'Suspenso', paused:'Pausado'
};

const frequencyLabel:Record<string,string> = {
  biweekly:'Quinzenal', monthly:'Mensal', quarterly:'Trimestral', annual:'Anual'
};

const billingLabel:Record<string,string> = {
  monthly:'Mensal', per_boleto:'Por boleto emitido', hybrid:'Mensal + por boleto'
};

function monthStartISO(){
  const d=new Date();
  return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)).toISOString();
}

function monthDateValue(){
  const d=new Date();
  return String(d.getFullYear())+'-'+String(d.getMonth()+1).padStart(2,'0')+'-01';
}

function parsePercent(value:string){
  const normalized=String(value||'').trim().replace(',','.');
  const parsed=Number(normalized);
  return Number.isFinite(parsed)?parsed:0;
}

function clientName(value:any){
  return Array.isArray(value) ? value[0]?.name : value?.name;
}

function roleLabel(role?:string){
  if(role==='owner')return 'Proprietário';
  if(role==='admin')return 'Administrador';
  if(role==='finance')return 'Financeiro';
  if(role==='viewer'||role==='member')return 'Consulta';
  return 'Usuário';
}

function auditActionLabel(action:string){
  if(action==='insert')return 'Criou';
  if(action==='update')return 'Alterou';
  if(action==='delete')return 'Removeu';
  return action;
}

function entityLabel(entity:string){
  const labels:Record<string,string>={
    clients:'cliente',charges:'cobrança',recurring_rules:'recorrência',
    organization_members:'usuário',organizations:'empresa',subscriptions:'assinatura',
    platform_invoices:'fatura'
  };
  return labels[entity]||entity;
}

export default function Home(){
  const {user,signOut}=useAuth();
  const supabase=useMemo(()=>getSupabaseBrowserClient(),[]);

  const [org,setOrg]=useState<any>(null);
  const [wallet,setWallet]=useState<any>(null);
  const [clients,setClients]=useState<Client[]>([]);
  const [charges,setCharges]=useState<Charge[]>([]);
  const [recurring,setRecurring]=useState<RecurringRule[]>([]);
  const [profile,setProfile]=useState<any>(null);
  const [membership,setMembership]=useState<any>(null);
  const [subscription,setSubscription]=useState<any>(null);
  const [platformInvoice,setPlatformInvoice]=useState<any>(null);
  const [mercadoPago,setMercadoPago]=useState<any>(null);
  const [baasConnection,setBaasConnection]=useState<any>(null);
  const [asaasBalanceCents,setAsaasBalanceCents]=useState<number|null>(null);
  const [walletTransactions,setWalletTransactions]=useState<WalletTransaction[]>([]);
  const [walletTransfers,setWalletTransfers]=useState<WalletTransfer[]>([]);
  const [teamMembers,setTeamMembers]=useState<TeamMember[]>([]);
  const [orgInvites,setOrgInvites]=useState<OrgInvite[]>([]);
  const [tenantAudit,setTenantAudit]=useState<AuditItem[]>([]);
  const [tenantTab,setTenantTab]=useState<TenantTab>('inicio');

  const [ownerTab,setOwnerTab]=useState<OwnerTab>('visao');
  const [platformOrgs,setPlatformOrgs]=useState<PlatformOrg[]>([]);
  const [plans,setPlans]=useState<Plan[]>([]);
  const [platformInvoices,setPlatformInvoices]=useState<PlatformInvoice[]>([]);
  const [chargeCounts,setChargeCounts]=useState<Record<string,number>>({});
  const [platformAudit,setPlatformAudit]=useState<AuditItem[]>([]);
  const [selectedOrgId,setSelectedOrgId]=useState('');
  const [ownerSnapshot,setOwnerSnapshot]=useState<OwnerSnapshot|null>(null);
  const [snapshotBusy,setSnapshotBusy]=useState(false);
  const [platformSettings,setPlatformSettings]=useState<any>({
    platform_name:'Sistema de Cobrança',
    trial_days:4,
    signup_enabled:true,
    default_plan_id:'',
    support_email:''
  });

  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState('');

  const [clientForm,setClientForm]=useState({
    name:'',document:'',email:'',whatsapp:'',deliveryPreference:'manual',
    zip_code:'',street_name:'',street_number:'',neighborhood:'',city:'',state:''
  });
  const [chargeForm,setChargeForm]=useState({
    clientId:'',description:'',amount:'',dueDate:'',paymentMethod:'internal',
    interestMonthly:'0,00',
    fineType:'percent',fineValue:'0,00',
    discountType:'percent',discountValue:'0,00',discountDeadlineDays:'0'
  });
  const [recurringForm,setRecurringForm]=useState({
    clientId:'',description:'',amount:'',frequency:'monthly',generationDay:'1',dueDay:'10'
  });
  const [newPlan,setNewPlan]=useState({
    code:'',name:'',billing_model:'monthly',monthly_price:'0,00',boleto_fee:'0,00',
    max_clients:'',max_users:'',active:true
  });
  const [invoiceMonth,setInvoiceMonth]=useState(monthDateValue());
  const [clientSearch,setClientSearch]=useState('');
  const [clientEdit,setClientEdit]=useState<Client|null>(null);
  const [chargeSearch,setChargeSearch]=useState('');
  const [chargeStatusFilter,setChargeStatusFilter]=useState('all');
  const [chargeEdit,setChargeEdit]=useState<{id:string;description:string;due_date:string}|null>(null);
  const [inviteForm,setInviteForm]=useState({email:'',role:'viewer'});
  const [pixTransferForm,setPixTransferForm]=useState({
    recipientName:'',destinationKey:'',amount:'',description:''
  });
  const [asaasAccountForm,setAsaasAccountForm]=useState({
    name:'',email:'',cpfCnpj:'',companyType:'LIMITED',taxRegime:'UNKNOWN',
    birthDate:'',mobilePhone:'',incomeValue:'',
    address:'',addressNumber:'',complement:'',province:'',postalCode:''
  });

  async function load(){
    if(!supabase||!user)return;
    setBusy(true);
    setMsg('');
    try{
      const {data:p,error:pe}=await supabase.from('profiles')
        .select('display_name,is_platform_admin').eq('id',user.id).maybeSingle();
      if(pe)throw pe;
      setProfile(p);

      if(p?.is_platform_admin){
        const [
          {data:orgs,error:oe},
          {data:subs,error:se},
          {data:planRows,error:ple},
          {data:settingsRows,error:sete},
          {data:invoiceRows,error:ie},
          {data:monthCharges,error:mce},
          {data:auditRows,error:ae}
        ]=await Promise.all([
          supabase.from('organizations').select('id,name,status,created_at').order('created_at',{ascending:false}).limit(250),
          supabase.from('subscriptions').select('organization_id,plan_id,status,trial_ends_at,plans(id,name)').limit(250),
          supabase.from('plans').select('id,code,name,billing_model,monthly_price_cents,boleto_fee_cents,max_clients,max_users,active').order('monthly_price_cents',{ascending:true}),
          supabase.from('platform_settings').select('platform_name,trial_days,signup_enabled,default_plan_id,support_email').eq('id',true).maybeSingle(),
          supabase.from('platform_invoices').select('id,organization_id,reference_month,total_cents,status,due_date,boleto_count,monthly_fee_cents,boleto_fee_cents,organizations(name),plans(name)').order('reference_month',{ascending:false}).limit(200),
          supabase.from('charges').select('organization_id,created_at').gte('created_at',monthStartISO()).neq('status','cancelled'),
          supabase.rpc('platform_audit_feed',{p_limit:120})
        ]);
        if(oe||se||ple||sete||ie||mce||ae)throw oe||se||ple||sete||ie||mce||ae;

        const subByOrg=new Map((subs??[]).map((s:any)=>[s.organization_id,s]));
        setPlatformOrgs((orgs??[]).map((item:any)=>{
          const sub:any=subByOrg.get(item.id);
          const linkedPlan=Array.isArray(sub?.plans)?sub?.plans?.[0]:sub?.plans;
          return {
            ...item,
            planId:sub?.plan_id,
            plan:linkedPlan?.name??'—',
            subscriptionStatus:sub?.status??'—',
            trialEndsAt:sub?.trial_ends_at
          };
        }));
        setPlans((planRows??[]) as any);
        if(settingsRows)setPlatformSettings(settingsRows);
        setPlatformInvoices((invoiceRows??[]) as any);
        setPlatformAudit((auditRows??[]) as any);

        const counts:Record<string,number>={};
        (monthCharges??[]).forEach((c:any)=>{counts[c.organization_id]=(counts[c.organization_id]??0)+1});
        setChargeCounts(counts);
        setBusy(false);
        return;
      }

      const {data:member,error:me}=await supabase.from('organization_members')
        .select('organization_id,role').eq('user_id',user.id).limit(1).maybeSingle();
      if(me)throw me;
      setMembership(member);

      if(!member){
        setMsg('Nenhuma empresa vinculada a este usuário.');
        setBusy(false);
        return;
      }

      const orgId=member.organization_id;
      const [
        {data:o,error:oe},
        {data:w,error:we},
        {data:c,error:ce},
        {data:ch,error:che},
        {data:rr,error:rre},
        {data:sub,error:se},
        {data:invoice,error:ine},
        {data:members,error:tme},
        {data:auditRows,error:tae},
        {data:provider,error:pre},
        {data:baas,error:bae},
        {data:txRows,error:txe},
        {data:transferRows,error:tre}
      ]=await Promise.all([
        supabase.from('organizations').select('id,name,status').eq('id',orgId).single(),
        supabase.from('wallet_accounts').select('id,account_number,pix_key,balance_cents').eq('organization_id',orgId).single(),
        supabase.from('clients').select('id,name,document,email,whatsapp,delivery_preference,address,status').eq('organization_id',orgId).order('created_at',{ascending:false}),
        supabase.from('charges').select('id,description,amount_cents,due_date,status,provider,payment_method,provider_charge_id,pix_provider_charge_id,created_at,boleto_url,digitable_line,pix_url,pix_code,clients(name,email,whatsapp)').eq('organization_id',orgId).order('created_at',{ascending:false}).limit(250),
        supabase.from('recurring_rules').select('id,description,amount_cents,frequency,generation_day,due_day,status,clients(name)').eq('organization_id',orgId).order('created_at',{ascending:false}),
        supabase.from('subscriptions').select('status,trial_ends_at,current_period_end,chosen_plan_at,plans(name,billing_model,monthly_price_cents,boleto_fee_cents,max_clients,max_users)').eq('organization_id',orgId).maybeSingle(),
        supabase.from('platform_invoices').select('id,status,total_cents,due_date,reference_month').eq('organization_id',orgId).order('created_at',{ascending:false}).limit(1).maybeSingle(),
        supabase.rpc('tenant_list_members'),
        supabase.rpc('tenant_audit_feed',{p_limit:80}),
        supabase.from('provider_connections')
          .select('provider,status,external_account_id,connected_at,metadata')
          .eq('organization_id',orgId)
          .eq('provider','mercadopago')
          .maybeSingle(),
        supabase.from('provider_connections')
          .select('provider,status,external_account_id,connected_at,metadata')
          .eq('organization_id',orgId)
          .eq('provider','baas')
          .maybeSingle(),
        supabase.from('transactions')
          .select('id,type,direction,description,counterpart,amount_cents,reference_id,created_at')
          .eq('organization_id',orgId)
          .order('created_at',{ascending:false})
          .limit(100),
        supabase.from('transfers')
          .select('id,recipient_name,destination_key,description,amount_cents,fee_cents,status,provider,provider_transfer_id,created_at,completed_at')
          .eq('sender_organization_id',orgId)
          .order('created_at',{ascending:false})
          .limit(100)
      ]);
      if(oe||we||ce||che||rre||se||ine||tme||tae||pre||bae||txe||tre)throw oe||we||ce||che||rre||se||ine||tme||tae||pre||bae||txe||tre;

      setOrg(o);setWallet(w);setClients((c??[]) as any);setCharges((ch??[]) as any);
      setRecurring((rr??[]) as any);setSubscription(sub);setPlatformInvoice(invoice);
      setTeamMembers((members??[]) as any);setTenantAudit((auditRows??[]) as any);setMercadoPago(provider);
      setBaasConnection(baas);setWalletTransactions((txRows??[]) as any);setWalletTransfers((transferRows??[]) as any);
      setAsaasAccountForm(form=>({
        ...form,
        name:form.name||o?.name||'',
        email:form.email||user?.email||''
      }));
      if(baas?.status==='connected'){
        try{
          const balanceResponse=await authenticatedFetch('/api/wallet/asaas/balance',{method:'GET'});
          const balanceData=await balanceResponse.json();
          if(balanceResponse.ok){
            setAsaasBalanceCents(Number(balanceData.balanceCents||0));
            setWallet((current:any)=>current?{...current,balance_cents:Number(balanceData.balanceCents||0)}:current);
          }
        }catch{
          setAsaasBalanceCents(null);
        }
      }else{
        setAsaasBalanceCents(null);
      }

      if(member.role==='owner'||member.role==='admin'){
        const {data:inviteRows,error:ive}=await supabase.from('organization_invites')
          .select('id,email,role,status,created_at')
          .eq('organization_id',orgId)
          .eq('status','pending')
          .order('created_at',{ascending:false});
        if(ive)throw ive;
        setOrgInvites((inviteRows??[]) as any);
      }else{
        setOrgInvites([]);
      }

      const {data:tenantPlans,error:tpe}=await supabase.from('plans').select('id,code,name,billing_model,monthly_price_cents,boleto_fee_cents,max_clients,max_users,active').eq('active',true).order('monthly_price_cents',{ascending:true});
      if(tpe)throw tpe;
      setPlans((tenantPlans??[]) as any);

      if(!chargeForm.clientId&&c?.[0]?.id)setChargeForm(f=>({...f,clientId:c[0].id}));
      if(!recurringForm.clientId&&c?.[0]?.id)setRecurringForm(f=>({...f,clientId:c[0].id}));
    }catch(e){
      setMsg(e instanceof Error?e.message:'Erro ao carregar dados.');
    }finally{
      setBusy(false);
    }
  }

  useEffect(()=>{
    load().finally(()=>{
      if(typeof window==='undefined')return;
      const params=new URLSearchParams(window.location.search);
      const mp=params.get('mp');
      const reason=params.get('reason');
      if(mp==='connected') setMsg('Mercado Pago conectado com sucesso.');
      if(mp==='error') setMsg('Não foi possível conectar o Mercado Pago'+(reason?': '+reason:'')+'.');
      if(mp) window.history.replaceState({},'',window.location.pathname);
    });
  },[user?.id]);

  async function runOwnerAction(action:()=>Promise<any>,success:string){
    setBusy(true);setMsg('');
    try{
      await action();
      setMsg(success);
      await load();
    }catch(e){
      setMsg(e instanceof Error?e.message:'Não foi possível concluir a operação.');
    }finally{
      setBusy(false);
    }
  }

  async function savePlan(plan:Plan){
    if(!supabase)return;
    await runOwnerAction(async()=>{
      const {error}=await supabase.rpc('platform_save_plan',{
        p_plan_id:plan.id,
        p_name:plan.name,
        p_billing_model:plan.billing_model,
        p_monthly_price_cents:Number(plan.monthly_price_cents||0),
        p_boleto_fee_cents:Number(plan.boleto_fee_cents||0),
        p_max_clients:plan.max_clients,
        p_max_users:plan.max_users,
        p_active:plan.active
      });
      if(error)throw error;
    },'Plano atualizado com sucesso.');
  }

  async function deletePlan(plan:Plan){
    if(!supabase)return;
    const ok=window.confirm('Excluir o plano "'+plan.name+'"? Esta ação só será permitida se ele não estiver vinculado a empresas, não for o plano padrão e não tiver histórico de faturamento.');
    if(!ok)return;
    await runOwnerAction(async()=>{
      const {error}=await supabase.rpc('platform_delete_plan',{p_plan_id:plan.id});
      if(error)throw error;
    },'Plano excluído com sucesso.');
  }

  async function createPlan(e:React.FormEvent){
    e.preventDefault();
    if(!supabase)return;
    await runOwnerAction(async()=>{
      const {error}=await supabase.rpc('platform_create_plan',{
        p_code:newPlan.code,
        p_name:newPlan.name,
        p_billing_model:newPlan.billing_model,
        p_monthly_price_cents:parseBRL(newPlan.monthly_price),
        p_boleto_fee_cents:parseBRL(newPlan.boleto_fee),
        p_max_clients:newPlan.max_clients?Number(newPlan.max_clients):null,
        p_max_users:newPlan.max_users?Number(newPlan.max_users):null,
        p_active:newPlan.active
      });
      if(error)throw error;
      setNewPlan({code:'',name:'',billing_model:'monthly',monthly_price:'0,00',boleto_fee:'0,00',max_clients:'',max_users:'',active:true});
    },'Novo plano criado.');
  }

  async function assignPlan(orgId:string,planId:string){
    if(!supabase)return;
    await runOwnerAction(async()=>{
      const {error}=await supabase.rpc('platform_assign_plan',{
        p_organization_id:orgId,p_plan_id:planId
      });
      if(error)throw error;
    },'Plano da empresa atualizado.');
  }

  async function changeOrgStatus(orgId:string,status:string){
    if(!supabase)return;
    await runOwnerAction(async()=>{
      const {error}=await supabase.rpc('platform_set_organization_status',{
        p_organization_id:orgId,p_status:status
      });
      if(error)throw error;
    },'Status da empresa atualizado.');
  }

  async function saveSettings(e:React.FormEvent){
    e.preventDefault();
    if(!supabase)return;
    await runOwnerAction(async()=>{
      const {error}=await supabase.rpc('platform_update_settings',{
        p_platform_name:platformSettings.platform_name,
        p_trial_days:Number(platformSettings.trial_days),
        p_signup_enabled:Boolean(platformSettings.signup_enabled),
        p_default_plan_id:platformSettings.default_plan_id||null,
        p_support_email:platformSettings.support_email||null
      });
      if(error)throw error;
    },'Configurações da plataforma atualizadas.');
  }

  async function generateInvoices(){
    if(!supabase)return;
    await runOwnerAction(async()=>{
      const {error}=await supabase.rpc('platform_generate_invoices',{
        p_reference_month:invoiceMonth,p_due_day:10
      });
      if(error)throw error;
    },'Faturamento do período gerado.');
  }

  async function setInvoiceStatus(id:string,status:string){
    if(!supabase)return;
    await runOwnerAction(async()=>{
      const {error}=await supabase.rpc('platform_set_invoice_status',{
        p_invoice_id:id,p_status:status
      });
      if(error)throw error;
    },'Fatura atualizada.');
  }

  async function chooseTenantPlan(plan:Plan){
    if(!supabase)return;
    const ok=window.confirm('Escolher o plano "'+plan.name+'"? A assinatura será ativada com este plano.');
    if(!ok)return;
    setBusy(true);setMsg('');
    try{
      const {error}=await supabase.rpc('tenant_choose_plan',{p_plan_id:plan.id});
      if(error)throw error;
      setMsg('Plano escolhido e assinatura ativada com sucesso.');
      await load();
      setTenantTab('inicio');
    }catch(e){
      setMsg(e instanceof Error?e.message:'Não foi possível escolher o plano.');
    }finally{
      setBusy(false);
    }
  }

  async function addClient(e:React.FormEvent){
    e.preventDefault();if(!supabase||!org)return;
    setBusy(true);setMsg('');
    const {name,document,email,whatsapp,deliveryPreference,zip_code,street_name,street_number,neighborhood,city,state}=clientForm;
    const {error}=await supabase.from('clients').insert({
      organization_id:org.id,name,document,email,whatsapp,delivery_preference:deliveryPreference,status:'active',
      address:{
        zip_code:zip_code.replace(/\D/g,''),street_name,street_number,neighborhood,city,
        state:state.toUpperCase().slice(0,2)
      }
    });
    if(error)setMsg(error.message);
    else{
      setClientForm({name:'',document:'',email:'',whatsapp:'',deliveryPreference:'manual',zip_code:'',street_name:'',street_number:'',neighborhood:'',city:'',state:''});
      setMsg('Cliente cadastrado com sucesso.');await load();setTenantTab('clientes')
    }
    setBusy(false);
  }

  async function authenticatedFetch(url:string,init:RequestInit={}){
    if(!supabase)throw new Error('Supabase não configurado.');
    const {data}=await supabase.auth.getSession();
    const token=data.session?.access_token;
    if(!token)throw new Error('Sessão expirada. Entre novamente.');
    return fetch(url,{
      ...init,
      headers:{'content-type':'application/json',authorization:'Bearer '+token,...(init.headers||{})}
    });
  }

  async function createAsaasAccount(e:React.FormEvent){
    e.preventDefault();
    const incomeCents=parseBRL(asaasAccountForm.incomeValue);
    if(incomeCents<=0){setMsg('Informe o faturamento ou renda mensal.');return}
    setBusy(true);setMsg('');
    try{
      const response=await authenticatedFetch('/api/integrations/asaas/subaccount',{
        method:'POST',
        body:JSON.stringify({
          ...asaasAccountForm,
          incomeValue:incomeCents/100
        })
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Não foi possível ativar a conta Asaas.');
      setMsg('Conta Asaas criada e conectada ao JP Sistema com sucesso.');
      await load();
    }catch(e){
      setMsg(e instanceof Error?e.message:'Não foi possível ativar a conta Asaas.');
    }finally{
      setBusy(false);
    }
  }

  async function refreshAsaasBalance(){
    setBusy(true);setMsg('');
    try{
      const response=await authenticatedFetch('/api/wallet/asaas/balance',{method:'GET'});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Não foi possível consultar o saldo Asaas.');
      setAsaasBalanceCents(Number(data.balanceCents||0));
      setWallet((current:any)=>current?{...current,balance_cents:Number(data.balanceCents||0)}:current);
      setMsg('Saldo Asaas atualizado.');
    }catch(e){
      setMsg(e instanceof Error?e.message:'Não foi possível consultar o saldo Asaas.');
    }finally{
      setBusy(false);
    }
  }

  async function connectMercadoPago(){
    setBusy(true);setMsg('');
    try{
      const response=await authenticatedFetch('/api/integrations/mercadopago/connect',{method:'POST'});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Não foi possível iniciar a conexão.');
      window.location.href=data.url;
    }catch(e){
      setMsg(e instanceof Error?e.message:'Não foi possível conectar o Mercado Pago.');
      setBusy(false);
    }
  }

  async function disconnectMercadoPago(){
    if(!window.confirm('Desconectar o Mercado Pago desta empresa?'))return;
    setBusy(true);setMsg('');
    try{
      const response=await authenticatedFetch('/api/integrations/mercadopago/disconnect',{method:'POST'});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Falha ao desconectar.');
      setMsg('Mercado Pago desconectado.');
      await load();
    }catch(e){setMsg(e instanceof Error?e.message:'Falha ao desconectar.')}
    finally{setBusy(false)}
  }

  async function generateMercadoPagoPayment(chargeId:string,method:'boleto'|'pix'|'both'){
    const response=await authenticatedFetch('/api/charges/mercadopago',{
      method:'POST',body:JSON.stringify({chargeId,method})
    });
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||(method==='pix'?'Não foi possível gerar o Pix.':method==='both'?'Não foi possível gerar boleto e Pix.':'Não foi possível gerar o boleto.'));
    return data;
  }

  async function submitPixTransfer(e:React.FormEvent){
    e.preventDefault();
    const amountCents=parseBRL(pixTransferForm.amount);
    if(amountCents<=0){setMsg('Informe um valor válido para o Pix.');return}
    if(baasConnection?.status!=='connected'){
      setMsg('Para enviar Pix para outros bancos, primeiro precisamos conectar uma instituição financeira BaaS.');
      return;
    }
    setBusy(true);setMsg('');
    try{
      const response=await authenticatedFetch('/api/wallet/pix',{
        method:'POST',
        body:JSON.stringify({
          recipientName:pixTransferForm.recipientName,
          destinationKey:pixTransferForm.destinationKey,
          amountCents,
          description:pixTransferForm.description
        })
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Não foi possível enviar o Pix.');
      setPixTransferForm({recipientName:'',destinationKey:'',amount:'',description:''});
      setMsg('Pix enviado com sucesso.');
      await load();
    }catch(e){
      setMsg(e instanceof Error?e.message:'Não foi possível enviar o Pix.');
    }finally{
      setBusy(false);
    }
  }

  async function addCharge(e:React.FormEvent){
    e.preventDefault();if(!supabase||!org)return;
    const amount=parseBRL(chargeForm.amount);
    if(amount<=0){setMsg('Informe um valor válido.');return}
    const interestMonthly=parsePercent(chargeForm.interestMonthly);
    const finePercent=chargeForm.fineType==='percent'?parsePercent(chargeForm.fineValue):0;
    const fineAmountCents=chargeForm.fineType==='fixed'?parseBRL(chargeForm.fineValue):0;
    const discountPercent=chargeForm.discountType==='percent'?parsePercent(chargeForm.discountValue):0;
    const discountAmountCents=chargeForm.discountType==='fixed'?parseBRL(chargeForm.discountValue):0;
    const discountDeadlineDays=Math.max(0,Number.parseInt(chargeForm.discountDeadlineDays||'0',10)||0);
    if(interestMonthly<0||interestMonthly>100||finePercent<0||finePercent>100||discountPercent<0||discountPercent>100){
      setMsg('Juros, multa e desconto percentual devem ficar entre 0% e 100%.');
      return;
    }
    const isMercadoPagoBoleto=chargeForm.paymentMethod==='mercadopago';
    const isMercadoPagoPix=chargeForm.paymentMethod==='mercadopago_pix';
    const isMercadoPagoBoth=chargeForm.paymentMethod==='mercadopago_both';
    const isMercadoPago=isMercadoPagoBoleto||isMercadoPagoPix||isMercadoPagoBoth;
    if(isMercadoPago&&mercadoPago?.status!=='connected'){
      setMsg('Conecte o Mercado Pago em Integrações antes de gerar pagamentos.');
      return;
    }
    const selectedClient=clients.find(c=>c.id===chargeForm.clientId);
    if(isMercadoPago){
      if(!selectedClient?.email){
        setMsg('Cadastre o e-mail do cliente antes de gerar o pagamento.');
        return;
      }
      if(isMercadoPagoBoleto||isMercadoPagoBoth){
        const document=String(selectedClient?.document||'').replace(/\D/g,'');
        if(![11,14].includes(document.length)){
          setMsg('Cadastre um CPF ou CNPJ válido no cliente antes de gerar o boleto.');
          return;
        }
        const address:any=selectedClient?.address||{};
        const requiredAddress=['zip_code','street_name','street_number','neighborhood','city','state'];
        if(requiredAddress.some(key=>!String(address[key]||'').trim())){
          setMsg('Complete o endereço do cliente: CEP, rua, número, bairro, cidade e UF.');
          return;
        }
      }
    }
    setBusy(true);setMsg('');
    const {data:created,error}=await supabase.from('charges').insert({
      organization_id:org.id,client_id:chargeForm.clientId,description:chargeForm.description,
      amount_cents:amount,due_date:chargeForm.dueDate,
      provider:isMercadoPago?'mercadopago':'mock',
      payment_method:isMercadoPagoPix?'pix':isMercadoPagoBoth?'boleto_pix':isMercadoPagoBoleto?'boleto':null,
      status:isMercadoPago?'draft':'pending',
      interest_monthly_percent:interestMonthly,
      fine_type:chargeForm.fineType,
      fine_percent:finePercent,
      fine_amount_cents:fineAmountCents,
      discount_type:chargeForm.discountType,
      discount_percent:discountPercent,
      discount_amount_cents:discountAmountCents,
      discount_deadline_days:discountDeadlineDays,
      send_email:['email','both'].includes(selectedClient?.delivery_preference||'manual'),
      send_whatsapp:['whatsapp','both'].includes(selectedClient?.delivery_preference||'manual')
    }).select('id').single();

    if(error)setMsg(error.message);
    else{
      try{
        let paymentResult:any=null;
        if(isMercadoPago)paymentResult=await generateMercadoPagoPayment(created.id,isMercadoPagoPix?'pix':isMercadoPagoBoth?'both':'boleto');
        setChargeForm(f=>({
          ...f,description:'',amount:'',dueDate:'',
          interestMonthly:'0,00',fineType:'percent',fineValue:'0,00',
          discountType:'percent',discountValue:'0,00',discountDeadlineDays:'0'
        }));
        const sentByEmail=Boolean(paymentResult?.email?.sent);
        setMsg(
          isMercadoPagoPix
            ? (sentByEmail?'Pix gerado e enviado por e-mail automaticamente.':'Pix Mercado Pago gerado com sucesso.')
            : isMercadoPagoBoth
              ? (sentByEmail?'Boleto e Pix gerados e enviados por e-mail para o cliente escolher.':'Boleto e Pix Mercado Pago gerados com sucesso.')
              : isMercadoPagoBoleto
                ? (sentByEmail?'Boleto gerado e enviado por e-mail automaticamente.':'Boleto Mercado Pago gerado com sucesso.')
                : 'Cobrança criada com sucesso.'
        );
      }catch(e){
        setMsg('Cobrança salva como rascunho. '+(e instanceof Error?e.message:'Não foi possível gerar o pagamento.'));
      }
      await load();setTenantTab('cobrancas')
    }
    setBusy(false);
  }

  async function addRecurring(e:React.FormEvent){
    e.preventDefault();if(!supabase||!org)return;
    const amount=parseBRL(recurringForm.amount);
    if(amount<=0){setMsg('Informe um valor válido.');return}
    setBusy(true);setMsg('');
    const recurringClient=clients.find(c=>c.id===recurringForm.clientId);
    const {error}=await supabase.from('recurring_rules').insert({
      organization_id:org.id,client_id:recurringForm.clientId,description:recurringForm.description,
      amount_cents:amount,frequency:recurringForm.frequency,generation_day:Number(recurringForm.generationDay),
      due_day:Number(recurringForm.dueDay),provider:'mock',status:'active',
      send_email:['email','both'].includes(recurringClient?.delivery_preference||'manual'),
      send_whatsapp:['whatsapp','both'].includes(recurringClient?.delivery_preference||'manual')
    });
    if(error)setMsg(error.message);
    else{setRecurringForm(f=>({...f,description:'',amount:''}));setMsg('Cobrança recorrente criada com sucesso.');await load();setTenantTab('recorrencias')}
    setBusy(false);
  }

  async function saveClientEdit(e:React.FormEvent){
    e.preventDefault();
    if(!supabase||!clientEdit)return;
    setBusy(true);setMsg('');
    const {error}=await supabase.from('clients').update({
      name:clientEdit.name,
      document:clientEdit.document||null,
      email:clientEdit.email||null,
      whatsapp:clientEdit.whatsapp||null,
      delivery_preference:clientEdit.delivery_preference||'manual',
      address:clientEdit.address||null,
      updated_at:new Date().toISOString()
    }).eq('id',clientEdit.id);
    if(error)setMsg(error.message);
    else{setMsg('Cliente atualizado com sucesso.');setClientEdit(null);await load()}
    setBusy(false);
  }

  async function toggleClientStatus(client:Client){
    if(!supabase)return;
    const next=client.status==='active'?'inactive':'active';
    setBusy(true);setMsg('');
    const {error}=await supabase.from('clients').update({status:next,updated_at:new Date().toISOString()}).eq('id',client.id);
    if(error)setMsg(error.message);
    else{setMsg(next==='active'?'Cliente reativado.':'Cliente inativado.');await load()}
    setBusy(false);
  }

  async function saveChargeEdit(e:React.FormEvent){
    e.preventDefault();
    if(!supabase||!chargeEdit)return;
    setBusy(true);setMsg('');
    const {error}=await supabase.from('charges').update({
      description:chargeEdit.description,
      due_date:chargeEdit.due_date,
      updated_at:new Date().toISOString()
    }).eq('id',chargeEdit.id);
    if(error)setMsg(error.message);
    else{setMsg('Cobrança atualizada.');setChargeEdit(null);await load()}
    setBusy(false);
  }

  async function cancelChargeAction(charge:Charge){
    if(!supabase)return;
    if(!window.confirm('Cancelar a cobrança "'+charge.description+'"?'))return;
    setBusy(true);setMsg('');
    try{
      if(charge.provider==='mercadopago'&&charge.provider_charge_id){
        const response=await authenticatedFetch('/api/charges/mercadopago/cancel',{
          method:'POST',body:JSON.stringify({chargeId:charge.id})
        });
        const data=await response.json();
        if(!response.ok)throw new Error(data.error||'Não foi possível cancelar no Mercado Pago.');
      }else{
        const {error}=await supabase.rpc('cancel_charge',{p_charge_id:charge.id});
        if(error)throw error;
      }
      setMsg('Cobrança cancelada.');await load()
    }catch(e){setMsg(e instanceof Error?e.message:'Não foi possível cancelar a cobrança.')}
    setBusy(false);
  }

  async function retryMercadoPagoBoleto(charge:Charge){
    setBusy(true);setMsg('');
    try{
      const method=charge.payment_method==='pix'?'pix':charge.payment_method==='boleto_pix'?'both':'boleto';
      await generateMercadoPagoPayment(charge.id,method);
      setMsg(charge.payment_method==='pix'?'Pix Mercado Pago gerado com sucesso.':charge.payment_method==='boleto_pix'?'Boleto e Pix Mercado Pago gerados com sucesso.':'Boleto Mercado Pago gerado com sucesso.');
      await load();
    }catch(e){setMsg(e instanceof Error?e.message:'Não foi possível gerar o pagamento.')}
    finally{setBusy(false)}
  }

  function chargeClient(charge:Charge){
    return Array.isArray(charge.clients)?charge.clients[0]:charge.clients;
  }

  function paymentShareText(charge:Charge){
    const client=chargeClient(charge);
    const method=charge.payment_method==='pix'?'Pix':charge.payment_method==='boleto_pix'?'boleto ou Pix':'boleto';
    const lines=[
      'Olá '+(client?.name||'')+',',
      '',
      'Segue sua cobrança '+method+' referente a '+charge.description+'.',
      'Valor: '+brl(Number(charge.amount_cents)),
      'Vencimento: '+dateBR(charge.due_date)
    ];
    if(charge.payment_method==='boleto_pix'){
      if(charge.boleto_url) lines.push('Boleto: '+charge.boleto_url);
      if(charge.digitable_line) lines.push('Linha digitável do boleto: '+charge.digitable_line);
      if(charge.pix_url) lines.push('Pix: '+charge.pix_url);
      if(charge.pix_code) lines.push('Pix Copia e Cola: '+charge.pix_code);
    }else{
      if(charge.boleto_url) lines.push('Link para pagamento: '+charge.boleto_url);
      if(charge.digitable_line) lines.push((charge.payment_method==='pix'?'Pix Copia e Cola: ':'Linha digitável: ')+charge.digitable_line);
    }
    lines.push('','JP Sistema de Cobrança');
    return lines.join('\n');
  }

  function openWhatsAppCharge(charge:Charge){
    const client=chargeClient(charge);
    let phone=String(client?.whatsapp||'').replace(/\D/g,'');
    if(phone.length>=10&&phone.length<=11) phone='55'+phone;
    const text=encodeURIComponent(paymentShareText(charge));
    window.open('https://wa.me/'+phone+'?text='+text,'_blank','noopener,noreferrer');
  }

  async function openEmailCharge(charge:Charge){
    setBusy(true);setMsg('');
    try{
      const response=await authenticatedFetch('/api/charges/email',{
        method:'POST',
        body:JSON.stringify({chargeId:charge.id})
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Não foi possível enviar o e-mail.');
      setMsg('Cobrança enviada por e-mail com sucesso.');
    }catch(e){
      setMsg(e instanceof Error?e.message:'Não foi possível enviar o e-mail.');
    }finally{
      setBusy(false);
    }
  }

  async function setRecurringStatusAction(id:string,status:string){
    if(!supabase)return;
    setBusy(true);setMsg('');
    const {error}=await supabase.from('recurring_rules').update({status,updated_at:new Date().toISOString()}).eq('id',id);
    if(error)setMsg(error.message);
    else{setMsg(status==='active'?'Recorrência ativada.':status==='paused'?'Recorrência pausada.':'Recorrência cancelada.');await load()}
    setBusy(false);
  }

  async function inviteMember(e:React.FormEvent){
    e.preventDefault();
    if(!supabase)return;
    setBusy(true);setMsg('');
    const {data,error}=await supabase.rpc('tenant_invite_member',{
      p_email:inviteForm.email,
      p_role:inviteForm.role
    });
    if(error)setMsg(error.message);
    else{
      setMsg(data==='added'
        ?'Usuário existente adicionado à empresa.'
        :'Convite registrado. A pessoa deve criar a conta usando exatamente este e-mail.');
      setInviteForm({email:'',role:'viewer'});
      await load();
    }
    setBusy(false);
  }

  async function setMemberRoleAction(userId:string,role:string){
    if(!supabase)return;
    setBusy(true);setMsg('');
    const {error}=await supabase.rpc('tenant_set_member_role',{p_user_id:userId,p_role:role});
    if(error)setMsg(error.message);
    else{setMsg('Perfil do usuário atualizado.');await load()}
    setBusy(false);
  }

  async function removeMemberAction(member:TeamMember){
    if(!supabase)return;
    if(!window.confirm('Remover '+(member.display_name||member.email||'este usuário')+' da empresa?'))return;
    setBusy(true);setMsg('');
    const {error}=await supabase.rpc('tenant_remove_member',{p_user_id:member.user_id});
    if(error)setMsg(error.message);
    else{setMsg('Usuário removido da empresa.');await load()}
    setBusy(false);
  }

  async function cancelInviteAction(invite:OrgInvite){
    if(!supabase)return;
    setBusy(true);setMsg('');
    const {error}=await supabase.rpc('tenant_cancel_invite',{p_invite_id:invite.id});
    if(error)setMsg(error.message);
    else{setMsg('Convite cancelado.');await load()}
    setBusy(false);
  }

  async function loadOwnerSnapshotAction(orgId:string){
    if(!supabase)return;
    setSelectedOrgId(orgId);
    setSnapshotBusy(true);
    setOwnerSnapshot(null);
    const {data,error}=await supabase.rpc('platform_organization_snapshot',{p_organization_id:orgId});
    if(error)setMsg(error.message);
    else setOwnerSnapshot(data as any);
    setSnapshotBusy(false);
  }

  const planMap=new Map(plans.map(p=>[p.id,p]));
  const activeOrgs=platformOrgs.filter(o=>['active','trialing'].includes(o.status)).length;
  const currentMonthBoletos=Object.values(chargeCounts).reduce((a,b)=>a+b,0);
  const projectedRevenue=platformOrgs.reduce((total,o)=>{
    if(o.status!=='active')return total;
    const p=o.planId?planMap.get(o.planId):undefined;
    if(!p)return total;
    const fixed=p.billing_model==='monthly'||p.billing_model==='hybrid'?Number(p.monthly_price_cents):0;
    const variable=p.billing_model==='per_boleto'||p.billing_model==='hybrid'?Number(p.boleto_fee_cents)*(chargeCounts[o.id]??0):0;
    return total+fixed+variable;
  },0);

  if(profile?.is_platform_admin){
    const ownerNav=[
      ['visao','Visão geral',LayoutDashboard],
      ['empresas','Empresas',Building2],
      ['planos','Planos',CreditCard],
      ['faturamento','Faturamento',CircleDollarSign],
      ['auditoria','Auditoria',History],
      ['configuracoes','Configurações',Settings]
    ] as const;

    return <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="tenant-brand jp-brand">
          <img className="jp-brand-logo" src="/jp-sistema-cobranca.jpg" alt="JP Sistema de Cobrança"/>
          <span className="jp-brand-subtitle">Administração da plataforma</span>
        </div>
        <div className="admin-owner-card"><Crown size={18}/><div><strong>{profile?.display_name||'Proprietário'}</strong><span>Dono da plataforma</span></div></div>
        <nav className="tenant-nav">
          {ownerNav.map(([id,label,Icon])=><button key={id} className={ownerTab===id?'active':''} onClick={()=>setOwnerTab(id)}>
            <Icon size={18}/><span>{label}</span>
          </button>)}
        </nav>
        <div className="tenant-side-bottom">
          <button className="tenant-logout" onClick={()=>signOut()}><LogOut size={17}/> Sair</button>
        </div>
      </aside>

      <section className="admin-main">
        <header className="tenant-topbar">
          <div><strong>Painel do proprietário</strong><span>{user?.email}</span></div>
          <button onClick={load} title="Atualizar"><RefreshCw size={17}/></button>
        </header>
        <main className="tenant-content admin-content">
          {msg&&<div className="notice">{msg}</div>}

          {ownerTab==='visao'&&<>
            <div className="tenant-heading"><div><span className="eyebrow">ADMINISTRAÇÃO</span><h1>Visão geral da plataforma</h1><p>Acompanhe empresas, cobranças e receita estimada.</p></div></div>
            <section className="admin-metrics">
              <div className="admin-kpi primary"><span>Empresas cadastradas</span><strong>{platformOrgs.length}</strong><small>{activeOrgs} ativas ou em teste</small></div>
              <div className="admin-kpi"><span>Planos ativos</span><strong>{plans.filter(p=>p.active).length}</strong><small>{plans.length} planos cadastrados</small></div>
              <div className="admin-kpi"><span>Boletos no mês</span><strong>{currentMonthBoletos}</strong><small>cobranças emitidas pelas empresas</small></div>
              <div className="admin-kpi"><span>Receita estimada</span><strong>{brl(projectedRevenue)}</strong><small>mensal + uso por boleto</small></div>
            </section>

            <div className="grid admin-grid">
              <section className="card tableCard">
                <div className="cardHead"><div><h2>Empresas recentes</h2><p>Últimas contas cadastradas</p></div><button className="text-action" onClick={()=>setOwnerTab('empresas')}>Gerenciar</button></div>
                <div className="tableWrap"><table><thead><tr><th>Empresa</th><th>Status</th><th>Plano</th><th>Boletos/mês</th></tr></thead><tbody>
                  {platformOrgs.slice(0,8).map(o=><tr key={o.id}><td><strong>{o.name}</strong></td><td><span className={'status '+o.status}>{statusLabel[o.status]||o.status}</span></td><td>{o.plan}</td><td>{chargeCounts[o.id]??0}</td></tr>)}
                </tbody></table></div>
              </section>
              <section className="card summary-card">
                <h2>Operação</h2>
                <div className="summary-row"><span>Cadastros</span><strong>{platformSettings.signup_enabled?'Liberados':'Bloqueados'}</strong></div>
                <div className="summary-row"><span>Teste grátis</span><strong>{platformSettings.trial_days} dias</strong></div>
                <div className="summary-row"><span>Plano padrão</span><strong>{plans.find(p=>p.id===platformSettings.default_plan_id)?.name||'—'}</strong></div>
                <div className="summary-row"><span>Faturas pendentes</span><strong>{platformInvoices.filter(i=>i.status==='pending').length}</strong></div>
              </section>
            </div>
          </>}

          {ownerTab==='empresas'&&<>
            <div className="tenant-heading"><div><span className="eyebrow">CLIENTES DA PLATAFORMA</span><h1>Empresas</h1><p>Altere plano e status e abra a ficha operacional completa de cada empresa.</p></div></div>
            <section className="card tableCard">
              <div className="cardHead"><div><h2>Empresas cadastradas</h2><p>{platformOrgs.length} contas na plataforma</p></div></div>
              <div className="tableWrap"><table className="admin-table"><thead><tr><th>Empresa</th><th>Plano</th><th>Status</th><th>Boletos no mês</th><th>Teste até</th><th>Ações</th></tr></thead><tbody>
                {platformOrgs.map(o=><tr key={o.id}>
                  <td><strong>{o.name}</strong><small className="cell-sub">{dateBR(o.created_at)}</small></td>
                  <td><select value={o.planId||''} onChange={e=>assignPlan(o.id,e.target.value)} disabled={busy}>
                    <option value="">Sem plano</option>{plans.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                  </select></td>
                  <td><select value={o.status} onChange={e=>changeOrgStatus(o.id,e.target.value)} disabled={busy}>
                    <option value="trialing">Em teste</option><option value="active">Ativo</option><option value="past_due">Pagamento pendente</option><option value="suspended">Suspenso</option><option value="cancelled">Cancelado</option>
                  </select></td>
                  <td>{chargeCounts[o.id]??0}</td>
                  <td>{o.trialEndsAt?dateBR(o.trialEndsAt):'—'}</td>
                  <td><div className="row-actions"><button onClick={()=>loadOwnerSnapshotAction(o.id)} disabled={snapshotBusy&&selectedOrgId===o.id}>Detalhes</button></div></td>
                </tr>)}
              </tbody></table></div>
            </section>

            {(snapshotBusy||ownerSnapshot)&&<section className="owner-company-detail">
              {snapshotBusy?<div className="card detail-loading">Carregando detalhes da empresa...</div>:ownerSnapshot&&<>
                <div className="tenant-heading company-detail-heading">
                  <div><span className="eyebrow">FICHA DA EMPRESA</span><h2>{ownerSnapshot.organization?.name}</h2><p>{ownerSnapshot.organization?.document||'Documento não informado'} · {ownerSnapshot.organization?.city||'Cidade não informada'}{ownerSnapshot.organization?.state?' / '+ownerSnapshot.organization.state:''}</p></div>
                  <span className={'status '+ownerSnapshot.organization?.status}>{statusLabel[ownerSnapshot.organization?.status]||ownerSnapshot.organization?.status}</span>
                </div>

                <section className="admin-metrics compact-admin-metrics">
                  <div className="admin-kpi"><span>Clientes</span><strong>{ownerSnapshot.counts?.clients??0}</strong><small>cadastrados</small></div>
                  <div className="admin-kpi"><span>Cobranças</span><strong>{ownerSnapshot.counts?.charges??0}</strong><small>emitidas</small></div>
                  <div className="admin-kpi"><span>Pagas</span><strong>{ownerSnapshot.counts?.paid_charges??0}</strong><small>confirmadas</small></div>
                  <div className="admin-kpi"><span>Usuários</span><strong>{ownerSnapshot.counts?.members??0}</strong><small>acessos</small></div>
                </section>

                <div className="grid owner-detail-grid">
                  <section className="card">
                    <h2>Assinatura</h2>
                    <div className="summary-row"><span>Plano</span><strong>{ownerSnapshot.subscription?.plan_name||'—'}</strong></div>
                    <div className="summary-row"><span>Status</span><strong>{statusLabel[ownerSnapshot.subscription?.status]||ownerSnapshot.subscription?.status||'—'}</strong></div>
                    <div className="summary-row"><span>Modelo</span><strong>{billingLabel[ownerSnapshot.subscription?.billing_model]||'—'}</strong></div>
                    <div className="summary-row"><span>Limite clientes</span><strong>{ownerSnapshot.subscription?.max_clients??'Ilimitado'}</strong></div>
                    <div className="summary-row"><span>Limite usuários</span><strong>{ownerSnapshot.subscription?.max_users??'Ilimitado'}</strong></div>
                  </section>

                  <section className="card">
                    <h2>Dados cadastrais</h2>
                    <div className="summary-row"><span>Razão social</span><strong>{ownerSnapshot.organization?.legal_name||'—'}</strong></div>
                    <div className="summary-row"><span>Telefone</span><strong>{ownerSnapshot.organization?.phone||'—'}</strong></div>
                    <div className="summary-row"><span>Segmento</span><strong>{ownerSnapshot.organization?.segment||'—'}</strong></div>
                    <div className="summary-row"><span>Cadastro</span><strong>{ownerSnapshot.organization?.created_at?dateBR(ownerSnapshot.organization.created_at):'—'}</strong></div>
                  </section>
                </div>

                <div className="grid owner-detail-grid">
                  <section className="card tableCard">
                    <div className="cardHead"><div><h2>Equipe</h2><p>Usuários vinculados à empresa</p></div></div>
                    <div className="tableWrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th></tr></thead><tbody>
                      {(ownerSnapshot.members||[]).map((m:any)=><tr key={m.user_id}><td>{m.display_name||'Usuário'}</td><td>{m.email||'—'}</td><td>{roleLabel(m.role)}</td></tr>)}
                      {!ownerSnapshot.members?.length&&<tr><td colSpan={3} className="empty">Nenhum usuário.</td></tr>}
                    </tbody></table></div>
                  </section>

                  <section className="card tableCard">
                    <div className="cardHead"><div><h2>Faturas recentes</h2><p>Cobrança da assinatura da plataforma</p></div></div>
                    <div className="tableWrap"><table><thead><tr><th>Referência</th><th>Valor</th><th>Status</th></tr></thead><tbody>
                      {(ownerSnapshot.recent_invoices||[]).map((i:any)=><tr key={i.id}><td>{dateBR(i.reference_month)}</td><td>{brl(Number(i.total_cents))}</td><td><span className={'status '+i.status}>{statusLabel[i.status]||i.status}</span></td></tr>)}
                      {!ownerSnapshot.recent_invoices?.length&&<tr><td colSpan={3} className="empty">Nenhuma fatura.</td></tr>}
                    </tbody></table></div>
                  </section>
                </div>

                <section className="card tableCard">
                  <div className="cardHead"><div><h2>Atividade recente</h2><p>Últimos eventos registrados para esta empresa</p></div></div>
                  <div className="tableWrap"><table><thead><tr><th>Quando</th><th>Ação</th><th>Item</th></tr></thead><tbody>
                    {(ownerSnapshot.recent_audit||[]).map((a:any)=><tr key={a.id}><td>{new Date(a.created_at).toLocaleString('pt-BR')}</td><td>{auditActionLabel(a.action)}</td><td>{entityLabel(a.entity_type)}{a.entity_id?' · '+String(a.entity_id).slice(0,8):''}</td></tr>)}
                    {!ownerSnapshot.recent_audit?.length&&<tr><td colSpan={3} className="empty">Nenhuma atividade registrada.</td></tr>}
                  </tbody></table></div>
                </section>
              </>}
            </section>}
          </>}

          {ownerTab==='planos'&&<>
            <div className="tenant-heading"><div><span className="eyebrow">COMERCIAL</span><h1>Planos e preços</h1><p>Cobre mensalidade, valor por boleto ou combine os dois modelos.</p></div></div>
            <section className="card create-plan-card">
              <h2>Criar novo plano</h2>
              <form onSubmit={createPlan}>
                <div className="admin-form-grid">
                  <label>Nome<input required value={newPlan.name} onChange={e=>setNewPlan({...newPlan,name:e.target.value})}/></label>
                  <label>Código<input required placeholder="ex: premium" value={newPlan.code} onChange={e=>setNewPlan({...newPlan,code:e.target.value})}/></label>
                  <label>Modelo<select value={newPlan.billing_model} onChange={e=>setNewPlan({...newPlan,billing_model:e.target.value as any})}><option value="monthly">Mensal</option><option value="per_boleto">Por boleto emitido</option><option value="hybrid">Mensal + por boleto</option></select></label>
                  <label>Mensalidade<input value={newPlan.monthly_price} onChange={e=>setNewPlan({...newPlan,monthly_price:e.target.value})}/></label>
                  <label>Valor por boleto<input value={newPlan.boleto_fee} onChange={e=>setNewPlan({...newPlan,boleto_fee:e.target.value})}/></label>
                  <label>Máx. clientes<input type="number" min="0" value={newPlan.max_clients} onChange={e=>setNewPlan({...newPlan,max_clients:e.target.value})}/></label>
                  <label>Máx. usuários<input type="number" min="0" value={newPlan.max_users} onChange={e=>setNewPlan({...newPlan,max_users:e.target.value})}/></label>
                </div>
                <button className="primaryBtn admin-save" disabled={busy}><Plus size={16}/> Criar plano</button>
              </form>
            </section>

            <div className="plan-admin-grid">
              {plans.map((p,index)=><section className="card plan-admin-card" key={p.id}>
                <div className="plan-card-head"><div><span className="eyebrow">{p.code}</span><h2>{p.name}</h2></div><label className="switch-label"><input type="checkbox" checked={p.active} onChange={e=>setPlans(rows=>rows.map((x,i)=>i===index?{...x,active:e.target.checked}:x))}/> Ativo</label></div>
                <label>Nome<input value={p.name} onChange={e=>setPlans(rows=>rows.map((x,i)=>i===index?{...x,name:e.target.value}:x))}/></label>
                <label>Modelo de cobrança<select value={p.billing_model} onChange={e=>setPlans(rows=>rows.map((x,i)=>i===index?{...x,billing_model:e.target.value as any}:x))}><option value="monthly">Mensal</option><option value="per_boleto">Por boleto emitido</option><option value="hybrid">Mensal + por boleto</option></select></label>
                <div className="cols">
                  <label>Mensalidade<input type="number" step="0.01" min="0" value={(Number(p.monthly_price_cents)/100).toFixed(2)} onChange={e=>setPlans(rows=>rows.map((x,i)=>i===index?{...x,monthly_price_cents:Math.round(Number(e.target.value||0)*100)}:x))}/></label>
                  <label>Por boleto<input type="number" step="0.01" min="0" value={(Number(p.boleto_fee_cents)/100).toFixed(2)} onChange={e=>setPlans(rows=>rows.map((x,i)=>i===index?{...x,boleto_fee_cents:Math.round(Number(e.target.value||0)*100)}:x))}/></label>
                </div>
                <div className="cols">
                  <label>Máx. clientes<input type="number" min="0" value={p.max_clients??''} onChange={e=>setPlans(rows=>rows.map((x,i)=>i===index?{...x,max_clients:e.target.value?Number(e.target.value):null}:x))}/></label>
                  <label>Máx. usuários<input type="number" min="0" value={p.max_users??''} onChange={e=>setPlans(rows=>rows.map((x,i)=>i===index?{...x,max_users:e.target.value?Number(e.target.value):null}:x))}/></label>
                </div>
                <div className="plan-price-preview">
                  <strong>{billingLabel[p.billing_model]}</strong>
                  <span>{p.billing_model!=='per_boleto'?brl(Number(p.monthly_price_cents))+'/mês':''}{p.billing_model==='hybrid'?' + ':''}{p.billing_model!=='monthly'?brl(Number(p.boleto_fee_cents))+'/boleto':''}</span>
                </div>
                <div className="plan-card-actions"><button className="primaryBtn" onClick={()=>savePlan(p)} disabled={busy}><Save size={16}/> Salvar alterações</button><button className="dangerBtn" onClick={()=>deletePlan(p)} disabled={busy}><Trash2 size={16}/> Excluir plano</button></div>
              </section>)}
            </div>
          </>}

          {ownerTab==='faturamento'&&<>
            <div className="tenant-heading"><div><span className="eyebrow">RECEITA DA PLATAFORMA</span><h1>Faturamento</h1><p>Gere e acompanhe as cobranças das empresas que usam a plataforma.</p></div>
              <div className="invoice-action"><input type="month" value={invoiceMonth.slice(0,7)} onChange={e=>setInvoiceMonth(e.target.value+'-01')}/><button className="primaryBtn compact" onClick={generateInvoices} disabled={busy}><ReceiptText size={16}/> Gerar faturamento</button></div>
            </div>
            <section className="metrics">
              <div className="metric primary"><span>Receita estimada no mês</span><strong>{brl(projectedRevenue)}</strong><small>conforme os planos atuais</small></div>
              <div className="metric"><span>Faturas pendentes</span><strong>{platformInvoices.filter(i=>i.status==='pending').length}</strong><small>aguardando pagamento</small></div>
              <div className="metric"><span>Faturas pagas</span><strong>{brl(platformInvoices.filter(i=>i.status==='paid').reduce((s,i)=>s+Number(i.total_cents),0))}</strong><small>histórico carregado</small></div>
            </section>
            <section className="card tableCard">
              <div className="cardHead"><div><h2>Faturas da plataforma</h2><p>Mensalidades e cobrança por boleto emitido</p></div></div>
              <div className="tableWrap"><table><thead><tr><th>Empresa</th><th>Referência</th><th>Boletos</th><th>Valor</th><th>Vencimento</th><th>Status</th><th>Ações</th></tr></thead><tbody>
                {platformInvoices.map(i=><tr key={i.id}>
                  <td><strong>{clientName(i.organizations)||'Empresa'}</strong></td><td>{dateBR(i.reference_month)}</td><td>{i.boleto_count}</td><td>{brl(Number(i.total_cents))}</td><td>{dateBR(i.due_date)}</td><td><span className={'status '+i.status}>{statusLabel[i.status]||i.status}</span></td>
                  <td><div className="row-actions">{i.status!=='paid'&&<button onClick={()=>setInvoiceStatus(i.id,'paid')}>Marcar paga</button>}{i.status!=='cancelled'&&<button onClick={()=>setInvoiceStatus(i.id,'cancelled')}>Cancelar</button>}</div></td>
                </tr>)}
                {!platformInvoices.length&&<tr><td colSpan={7} className="empty">Nenhuma fatura gerada ainda.</td></tr>}
              </tbody></table></div>
            </section>
          </>}

          {ownerTab==='auditoria'&&<>
            <div className="tenant-heading"><div><span className="eyebrow">AUDITORIA GLOBAL</span><h1>Atividade da plataforma</h1><p>Acompanhe alterações feitas nas empresas e nas operações do sistema.</p></div></div>
            <section className="card tableCard">
              <div className="cardHead"><div><h2>Eventos recentes</h2><p>Até 120 eventos mais recentes carregados</p></div></div>
              <div className="tableWrap"><table><thead><tr><th>Quando</th><th>Empresa</th><th>Usuário</th><th>Ação</th><th>Item</th></tr></thead><tbody>
                {platformAudit.map(item=><tr key={item.id}>
                  <td>{new Date(item.created_at).toLocaleString('pt-BR')}</td><td>{item.organization_name||'Plataforma'}</td><td>{item.actor_name||item.actor_email||'Sistema'}</td><td>{auditActionLabel(item.action)}</td><td>{entityLabel(item.entity_type)}{item.entity_id?' · '+item.entity_id.slice(0,8):''}</td>
                </tr>)}
                {!platformAudit.length&&<tr><td colSpan={5} className="empty">Ainda não há atividades registradas.</td></tr>}
              </tbody></table></div>
            </section>
          </>}

          {ownerTab==='configuracoes'&&<>
            <div className="tenant-heading"><div><span className="eyebrow">PLATAFORMA</span><h1>Configurações</h1><p>Defina regras de cadastro e operação da plataforma.</p></div></div>
            <div className="grid">
              <section className="card">
                <h2>Configurações gerais</h2>
                <form onSubmit={saveSettings}>
                  <label>Nome da plataforma<input value={platformSettings.platform_name||''} onChange={e=>setPlatformSettings({...platformSettings,platform_name:e.target.value})}/></label>
                  <label>E-mail de suporte<input type="email" value={platformSettings.support_email||''} onChange={e=>setPlatformSettings({...platformSettings,support_email:e.target.value})}/></label>
                  <div className="cols">
                    <label>Dias de teste<input type="number" min="0" max="365" value={platformSettings.trial_days} onChange={e=>setPlatformSettings({...platformSettings,trial_days:Number(e.target.value)})}/></label>
                    <label>Plano padrão<select value={platformSettings.default_plan_id||''} onChange={e=>setPlatformSettings({...platformSettings,default_plan_id:e.target.value})}><option value="">Selecione</option>{plans.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                  </div>
                  <label className="check-line"><input type="checkbox" checked={Boolean(platformSettings.signup_enabled)} onChange={e=>setPlatformSettings({...platformSettings,signup_enabled:e.target.checked})}/> Permitir novos cadastros</label>
                  <button className="primaryBtn" disabled={busy}><Save size={16}/> Salvar configurações</button>
                </form>
              </section>
              <section className="card admin-help-card">
                <Settings size={26}/><h2>O que você controla aqui</h2>
                <p>Você pode escolher o plano que será aplicado automaticamente a novas empresas, quantos dias de teste serão oferecidos e se novos cadastros ficarão liberados.</p>
                <p>Os preços dos planos são administrados na área <strong>Planos</strong>, inclusive cobrança por mês, por boleto emitido ou os dois juntos.</p>
              </section>
            </div>
          </>}
        </main>
      </section>
    </div>;
  }

  const nowDate=new Date();
  const todayStart=new Date(nowDate.getFullYear(),nowDate.getMonth(),nowDate.getDate());
  const next30Days=new Date(todayStart);
  next30Days.setDate(next30Days.getDate()+30);

  const chargeDueDate=(c:Charge)=>new Date(c.due_date+'T12:00:00');
  const isComputedOverdue=(c:Charge)=>{
    if(c.status==='overdue')return true;
    return ['pending','draft'].includes(c.status)&&chargeDueDate(c)<todayStart;
  };

  const receivedCharges=charges.filter(c=>c.status==='paid');
  const awaitingCharges=charges.filter(c=>['pending','draft'].includes(c.status)&&!isComputedOverdue(c));
  const overdueCharges=charges.filter(c=>isComputedOverdue(c));
  const openCharges=charges.filter(c=>['pending','draft','overdue'].includes(c.status));
  const open=openCharges.reduce((s,c)=>s+Number(c.amount_cents),0);
  const paid=receivedCharges.reduce((s,c)=>s+Number(c.amount_cents),0);
  const overdue=overdueCharges.reduce((s,c)=>s+Number(c.amount_cents),0);
  const awaiting=awaitingCharges.reduce((s,c)=>s+Number(c.amount_cents),0);
  const forecastCharges=awaitingCharges.filter(c=>{
    const due=chargeDueDate(c);
    return due>=todayStart&&due<=next30Days;
  });
  const forecast=forecastCharges.reduce((s,c)=>s+Number(c.amount_cents),0);

  const monthlyChart=Array.from({length:6},(_,index)=>{
    const d=new Date(nowDate.getFullYear(),nowDate.getMonth()-(5-index),1);
    const year=d.getFullYear();
    const month=d.getMonth();
    const monthCharges=charges.filter(c=>{
      const due=chargeDueDate(c);
      return due.getFullYear()===year&&due.getMonth()===month;
    });
    return {
      key:year+'-'+String(month+1).padStart(2,'0'),
      label:d.toLocaleDateString('pt-BR',{month:'short'}).replace('.',''),
      received:monthCharges.filter(c=>c.status==='paid').reduce((s,c)=>s+Number(c.amount_cents),0),
      awaiting:monthCharges.filter(c=>['pending','draft'].includes(c.status)&&!isComputedOverdue(c)).reduce((s,c)=>s+Number(c.amount_cents),0),
      overdue:monthCharges.filter(c=>isComputedOverdue(c)).reduce((s,c)=>s+Number(c.amount_cents),0),
    };
  });
  const chartMax=Math.max(1,...monthlyChart.map(m=>m.received+m.awaiting+m.overdue));
  const planObj=Array.isArray(subscription?.plans)?subscription?.plans?.[0]:subscription?.plans;
  const planName=planObj?.name;
  const planPrice=planObj?.monthly_price_cents;
  const planBoletoFee=planObj?.boleto_fee_cents;
  const planBillingModel=planObj?.billing_model;
  const trialEnd=subscription?.trial_ends_at?new Date(subscription.trial_ends_at):null;
  const trialExpired=Boolean(subscription?.status==='trialing'&&trialEnd&&trialEnd.getTime()<=Date.now());
  const needsPlanChoice=Boolean(trialExpired&&!subscription?.chosen_plan_at);
  const paymentPending=Boolean(subscription?.status==='past_due'&&subscription?.chosen_plan_at);
  const accountSuspended=Boolean(subscription?.status==='suspended'||subscription?.status==='cancelled');
  const tenantAccessBlocked=needsPlanChoice||paymentPending||accountSuspended;
  const trialDaysLeft=trialEnd?Math.max(0,Math.ceil((trialEnd.getTime()-Date.now())/86400000)):0;
  const canManageFinance=['owner','admin','finance'].includes(membership?.role);
  const canManageTeam=['owner','admin'].includes(membership?.role);
  const baasConnected=baasConnection?.status==='connected';
  const mercadoPagoConnected=mercadoPago?.status==='connected';
  const asaasWalletId=baasConnection?.metadata?.walletId||null;
  const accountBalanceCents=baasConnected?(asaasBalanceCents??Number(wallet?.balance_cents??0)):Number(wallet?.balance_cents??0);
  const planMaxClients=planObj?.max_clients??null;
  const planMaxUsers=planObj?.max_users??null;
  const filteredClients=clients.filter(client=>{
    const q=clientSearch.trim().toLowerCase();
    return !q
      || client.name.toLowerCase().includes(q)
      || (client.document||'').toLowerCase().includes(q)
      || (client.email||'').toLowerCase().includes(q);
  });
  const filteredCharges=charges.filter(charge=>{
    const q=chargeSearch.trim().toLowerCase();
    const computedStatus=isComputedOverdue(charge)?'overdue':charge.status;
    const matchesText=!q
      || charge.description.toLowerCase().includes(q)
      || (clientName(charge.clients)||'').toLowerCase().includes(q);
    const matchesStatus=chargeStatusFilter==='all'||computedStatus===chargeStatusFilter;
    return matchesText&&matchesStatus;
  });

  const tenantNav=[
    ['inicio','Início',LayoutDashboard],['clientes','Clientes',UsersRound],['cobrancas','Cobranças',ReceiptText],
    ['recorrencias','Recorrências',CalendarClock],['conta_digital','Conta digital',WalletCards],['integracoes','Integrações',Landmark],['equipe','Equipe',UserCog],['atividade','Atividade',History],
    ['relatorios','Relatórios',BarChart3],['assinatura','Assinatura',WalletCards],['conta','Minha conta',UserCircle2]
  ] as const;

  return <div className="tenant-shell">
    <aside className="tenant-sidebar">
      <div className="tenant-brand jp-brand"><img className="jp-brand-logo" src="/jp-sistema-cobranca.jpg" alt="JP Sistema de Cobrança"/><span className="jp-brand-subtitle">Área do cliente</span></div>
      <div className="company-card"><Building2 size={18}/><div><strong>{org?.name??'Sua empresa'}</strong><span>{planName?'Plano '+planName:'Conta empresarial'}</span></div></div>
      <nav className="tenant-nav">{tenantNav.map(([id,label,Icon])=><button key={id} className={tenantTab===id?'active':''} onClick={()=>setTenantTab(id)}><Icon size={18}/><span>{label}</span></button>)}</nav>
      <div className="tenant-side-bottom"><div className="tenant-user"><div className="avatar">{(profile?.display_name?.[0]??user?.email?.[0]??'U').toUpperCase()}</div><div><strong>{profile?.display_name??'Usuário'}</strong><span>{roleLabel(membership?.role)}</span></div></div><button className="tenant-logout" onClick={()=>signOut()}><LogOut size={17}/> Sair</button></div>
    </aside>

    <section className="tenant-main">
      <header className="tenant-topbar"><div><strong>{org?.name??'Minha empresa'}</strong><span>{user?.email}</span></div><button onClick={load} title="Atualizar"><RefreshCw size={17}/></button></header>
      <main className="tenant-content">
        {msg&&<div className="notice">{msg}</div>}

        {needsPlanChoice&&<section className="plan-selection-page">
          <div className="plan-selection-hero">
            <div className="plan-selection-icon"><Sparkles size={24}/></div>
            <span className="eyebrow">SEU TESTE GRÁTIS TERMINOU</span>
            <h1>Escolha o plano ideal para sua empresa</h1>
            <p>Os seus dados continuam salvos. Selecione uma opção abaixo para liberar novamente o acesso completo ao Sistema de Cobrança.</p>
            <div className="plan-selection-safe"><CheckCircle2 size={16}/> Nenhum cliente, cobrança ou configuração será perdido.</div>
          </div>

          {plans.filter(p=>p.active).length>0?<div className="plan-selection-grid">
            {plans.filter(p=>p.active).map((p,index)=>{
              const activePlans=plans.filter(x=>x.active);
              const recommended=p.code==='profissional'||(activePlans.length===3&&index===1);
              return <article className={'plan-selection-card '+(recommended?'recommended':'')} key={p.id}>
                {recommended&&<div className="recommended-badge">Mais escolhido</div>}
                <div className="plan-selection-card-head">
                  <span className="plan-code">{p.code}</span>
                  <h2>{p.name}</h2>
                  <p>{billingLabel[p.billing_model]}</p>
                </div>

                <div className="plan-selection-price">
                  {p.billing_model!=='per_boleto'&&<div><strong>{brl(Number(p.monthly_price_cents))}</strong><span>/mês</span></div>}
                  {p.billing_model==='hybrid'&&<b>+</b>}
                  {p.billing_model!=='monthly'&&<div><strong>{brl(Number(p.boleto_fee_cents))}</strong><span>/boleto emitido</span></div>}
                </div>

                <div className="plan-selection-features">
                  <div><CheckCircle2 size={16}/><span>{p.max_clients?'Até '+p.max_clients+' clientes':'Clientes ilimitados'}</span></div>
                  <div><CheckCircle2 size={16}/><span>{p.max_users?'Até '+p.max_users+' usuários':'Usuários ilimitados'}</span></div>
                  <div><CheckCircle2 size={16}/><span>Cobranças e recorrências</span></div>
                  <div><CheckCircle2 size={16}/><span>Relatórios financeiros</span></div>
                </div>

                <button className={recommended?'plan-select-button primary':'plan-select-button'} onClick={()=>chooseTenantPlan(p)} disabled={busy}>
                  {busy?'Processando...':'Escolher '+p.name}
                </button>
              </article>
            })}
          </div>:<div className="plan-selection-empty">
            <h2>Nenhum plano disponível no momento</h2>
            <p>Entre em contato com o administrador da plataforma para liberar um plano.</p>
          </div>}

          <div className="plan-selection-footer">
            <ShieldCheck size={18}/>
            <span>O acesso é liberado assim que o plano é escolhido. O plano poderá ser administrado posteriormente na área de assinatura.</span>
          </div>
        </section>}

        {paymentPending&&<section className="operational-blocked-card">
          <div className="operational-blocked-icon"><CircleDollarSign size={26}/></div>
          <span className="eyebrow">PAGAMENTO PENDENTE</span>
          <h1>Seu plano foi escolhido e aguarda liberação</h1>
          <p>A assinatura será liberada assim que o pagamento da fatura da plataforma for confirmado pelo administrador.</p>
          <div className="blocked-invoice-box">
            <div><span>Plano</span><strong>{planName??'—'}</strong></div>
            <div><span>Valor da fatura</span><strong>{platformInvoice?brl(Number(platformInvoice.total_cents)):typeof planPrice==='number'?brl(planPrice):'—'}</strong></div>
            <div><span>Vencimento</span><strong>{platformInvoice?.due_date?dateBR(platformInvoice.due_date):'—'}</strong></div>
            <div><span>Status</span><span className="status past_due">Aguardando pagamento</span></div>
          </div>
          <p className="blocked-help">Se você já realizou o pagamento, entre em contato com o suporte para a confirmação manual enquanto a integração automática de pagamentos não estiver ativa.</p>
        </section>}

        {accountSuspended&&<section className="operational-blocked-card">
          <div className="operational-blocked-icon warning"><TriangleAlert size={26}/></div>
          <span className="eyebrow">ACESSO RESTRITO</span>
          <h1>{subscription?.status==='cancelled'?'Assinatura cancelada':'Conta temporariamente suspensa'}</h1>
          <p>Os dados da empresa permanecem armazenados, mas novas operações estão bloqueadas. Entre em contato com o administrador da plataforma para regularizar o acesso.</p>
        </section>}

        {!needsPlanChoice&&subscription?.status==='trialing'&&!trialExpired&&<div className="trial-banner">
          <div><strong>Teste grátis por 4 dias</strong><span>{trialDaysLeft>1?trialDaysLeft+' dias restantes':trialDaysLeft===1?'1 dia restante':'Último dia do teste'}</span></div>
          <div>Termina em <strong>{trialEnd?dateBR(trialEnd.toISOString()):'—'}</strong>. Depois você poderá escolher o plano.</div>
        </div>}

        {!tenantAccessBlocked&&tenantTab==='inicio'&&<>
          <div className="tenant-heading dashboard-heading">
            <div><span className="eyebrow">VISÃO FINANCEIRA</span><h1>Olá, {profile?.display_name?.split(' ')?.[0]??'bem-vindo'}!</h1><p>Acompanhe o que entrou, o que está para receber e o que precisa de atenção.</p></div>
            <div className="dashboard-heading-actions">
              <div className="balance-chip"><span>Saldo disponível</span><strong>{brl(Number(wallet?.balance_cents??0))}</strong></div>
              <button className="primaryBtn compact" onClick={()=>setTenantTab('cobrancas')}><Plus size={16}/> Nova cobrança</button>
            </div>
          </div>

          <section className="finance-overview-grid">
            <article className="finance-overview-card received-card">
              <div className="finance-card-top"><div className="finance-card-icon"><CheckCircle2 size={19}/></div><span>Recebidas</span></div>
              <strong>{brl(paid)}</strong>
              <small>{receivedCharges.length} cobrança{receivedCharges.length===1?'':'s'} paga{receivedCharges.length===1?'':'s'}</small>
            </article>
            <article className="finance-overview-card awaiting-card">
              <div className="finance-card-top"><div className="finance-card-icon"><Clock3 size={19}/></div><span>Aguardando pagamento</span></div>
              <strong>{brl(awaiting)}</strong>
              <small>{awaitingCharges.length} cobrança{awaitingCharges.length===1?'':'s'} em aberto</small>
            </article>
            <article className="finance-overview-card overdue-card">
              <div className="finance-card-top"><div className="finance-card-icon"><TriangleAlert size={19}/></div><span>Vencidas</span></div>
              <strong>{brl(overdue)}</strong>
              <small>{overdueCharges.length} cobrança{overdueCharges.length===1?'':'s'} vencida{overdueCharges.length===1?'':'s'}</small>
            </article>
            <article className="finance-overview-card forecast-card">
              <div className="finance-card-top"><div className="finance-card-icon"><TrendingUp size={19}/></div><span>Previsão de recebimento</span></div>
              <strong>{brl(forecast)}</strong>
              <small>próximos 30 dias · {forecastCharges.length} cobrança{forecastCharges.length===1?'':'s'}</small>
            </article>
          </section>

          <div className="dashboard-analytics-grid">
            <section className="card monthly-chart-card">
              <div className="cardHead dashboard-card-head">
                <div><h2>Movimentação mensal</h2><p>Últimos 6 meses, conforme o vencimento das cobranças</p></div>
                <div className="chart-legend">
                  <span><i className="legend-dot received"></i>Recebidas</span>
                  <span><i className="legend-dot awaiting"></i>Aguardando</span>
                  <span><i className="legend-dot overdue"></i>Vencidas</span>
                </div>
              </div>
              <div className="monthly-chart">
                <div className="chart-y-label">{brl(chartMax)}</div>
                <div className="chart-plot">
                  {monthlyChart.map(month=><div className="chart-month" key={month.key}>
                    <div className="chart-bars">
                      <div className="chart-bar received" style={{height:Math.max(month.received?6:0,(month.received/chartMax)*100)+'%'}} title={'Recebidas: '+brl(month.received)}></div>
                      <div className="chart-bar awaiting" style={{height:Math.max(month.awaiting?6:0,(month.awaiting/chartMax)*100)+'%'}} title={'Aguardando: '+brl(month.awaiting)}></div>
                      <div className="chart-bar overdue" style={{height:Math.max(month.overdue?6:0,(month.overdue/chartMax)*100)+'%'}} title={'Vencidas: '+brl(month.overdue)}></div>
                    </div>
                    <span>{month.label}</span>
                  </div>)}
                </div>
              </div>
            </section>

            <section className="card month-summary-card">
              <div className="cardHead"><div><h2>Resumo financeiro</h2><p>Visão rápida da operação</p></div></div>
              <div className="dashboard-summary-list">
                <div><span>Total em aberto</span><strong>{brl(open)}</strong></div>
                <div><span>Clientes cadastrados</span><strong>{clients.length}</strong></div>
                <div><span>Recorrências ativas</span><strong>{recurring.filter(r=>r.status==='active').length}</strong></div>
                <div><span>Plano atual</span><strong>{planName??'—'}</strong></div>
              </div>
              <button className="dashboard-report-link" onClick={()=>setTenantTab('relatorios')}><BarChart3 size={16}/> Ver relatórios</button>
            </section>
          </div>

          <section className="card tableCard dashboard-recent-card">
            <div className="cardHead"><div><h2>Cobranças recentes</h2><p>Últimos lançamentos da empresa</p></div><button className="text-action" onClick={()=>setTenantTab('cobrancas')}>Ver todas</button></div>
            <div className="tableWrap"><table><thead><tr><th>Cliente</th><th>Descrição</th><th>Vencimento</th><th>Status</th><th>Valor</th></tr></thead><tbody>
              {charges.slice(0,6).map(c=><tr key={c.id}><td>{clientName(c.clients)||'Cliente'}</td><td>{c.description}</td><td>{dateBR(c.due_date)}</td><td><span className={'status '+(isComputedOverdue(c)?'overdue':c.status)}>{isComputedOverdue(c)?'Em atraso':(statusLabel[c.status]||c.status)}</span></td><td><strong>{brl(Number(c.amount_cents))}</strong></td></tr>)}
              {!charges.length&&<tr><td colSpan={5} className="empty">Nenhuma cobrança cadastrada.</td></tr>}
            </tbody></table></div>
          </section>
        </>}

        {!tenantAccessBlocked&&tenantTab==='clientes'&&<>
          <div className="tenant-heading">
            <div><span className="eyebrow">CADASTROS</span><h1>Clientes</h1><p>Cadastre, edite e inative clientes da sua empresa.</p></div>
            <div className="usage-pill"><span>Uso do plano</span><strong>{clients.filter(c=>c.status==='active').length}{planMaxClients?'/'+planMaxClients:''}</strong></div>
          </div>

          <div className="grid">
            <section className="card">
              <h2>{clientEdit?'Editar cliente':'Novo cliente'}</h2>
              {clientEdit?<form onSubmit={saveClientEdit}>
                <label>Nome / Razão social<input required value={clientEdit.name} onChange={e=>setClientEdit({...clientEdit,name:e.target.value})}/></label>
                <label>CPF / CNPJ<input value={clientEdit.document??''} onChange={e=>setClientEdit({...clientEdit,document:e.target.value})}/></label>
                <div className="cols">
                  <label>E-mail<input type="email" value={clientEdit.email??''} onChange={e=>setClientEdit({...clientEdit,email:e.target.value})}/></label>
                  <label>WhatsApp<input value={clientEdit.whatsapp??''} onChange={e=>setClientEdit({...clientEdit,whatsapp:e.target.value})}/></label>
                </div>
                <label>Enviar cobranças automaticamente por
                  <select value={clientEdit.delivery_preference||'manual'} onChange={e=>setClientEdit({...clientEdit,delivery_preference:e.target.value as Client['delivery_preference']})}>
                    <option value="manual">Não enviar automaticamente</option>
                    <option value="email">Somente e-mail</option>
                    <option value="whatsapp">Somente WhatsApp</option>
                    <option value="both">E-mail e WhatsApp</option>
                  </select>
                </label>
                <div className="address-fields">
                  <label>CEP<input value={clientEdit.address?.zip_code??''} onChange={e=>setClientEdit({...clientEdit,address:{...(clientEdit.address||{}),zip_code:e.target.value}})}/></label>
                  <label>Rua<input value={clientEdit.address?.street_name??''} onChange={e=>setClientEdit({...clientEdit,address:{...(clientEdit.address||{}),street_name:e.target.value}})}/></label>
                  <label>Número<input value={clientEdit.address?.street_number??''} onChange={e=>setClientEdit({...clientEdit,address:{...(clientEdit.address||{}),street_number:e.target.value}})}/></label>
                  <label>Bairro<input value={clientEdit.address?.neighborhood??''} onChange={e=>setClientEdit({...clientEdit,address:{...(clientEdit.address||{}),neighborhood:e.target.value}})}/></label>
                  <label>Cidade<input value={clientEdit.address?.city??''} onChange={e=>setClientEdit({...clientEdit,address:{...(clientEdit.address||{}),city:e.target.value}})}/></label>
                  <label>UF<input maxLength={2} value={clientEdit.address?.state??''} onChange={e=>setClientEdit({...clientEdit,address:{...(clientEdit.address||{}),state:e.target.value.toUpperCase().slice(0,2)}})}/></label>
                </div>
                <div className="form-actions"><button className="primaryBtn" disabled={busy}><Save size={16}/> Salvar cliente</button><button type="button" className="secondaryBtn" onClick={()=>setClientEdit(null)}>Cancelar</button></div>
              </form>:<form onSubmit={addClient}>
                <label>Nome / Razão social<input required value={clientForm.name} onChange={e=>setClientForm({...clientForm,name:e.target.value})}/></label>
                <label>CPF / CNPJ<input value={clientForm.document} onChange={e=>setClientForm({...clientForm,document:e.target.value})}/></label>
                <div className="cols"><label>E-mail<input type="email" value={clientForm.email} onChange={e=>setClientForm({...clientForm,email:e.target.value})}/></label><label>WhatsApp<input value={clientForm.whatsapp} onChange={e=>setClientForm({...clientForm,whatsapp:e.target.value})}/></label></div>
                <label>Enviar cobranças automaticamente por
                  <select value={clientForm.deliveryPreference} onChange={e=>setClientForm({...clientForm,deliveryPreference:e.target.value})}>
                    <option value="manual">Não enviar automaticamente</option>
                    <option value="email">Somente e-mail</option>
                    <option value="whatsapp">Somente WhatsApp</option>
                    <option value="both">E-mail e WhatsApp</option>
                  </select>
                </label>
                <p className="permission-note">A preferência será aplicada automaticamente às novas cobranças deste cliente.</p>
                <div className="address-fields">
                  <label>CEP<input value={clientForm.zip_code} onChange={e=>setClientForm({...clientForm,zip_code:e.target.value})} placeholder="00000-000"/></label>
                  <label>Rua<input value={clientForm.street_name} onChange={e=>setClientForm({...clientForm,street_name:e.target.value})}/></label>
                  <label>Número<input value={clientForm.street_number} onChange={e=>setClientForm({...clientForm,street_number:e.target.value})} placeholder="S/N"/></label>
                  <label>Bairro<input value={clientForm.neighborhood} onChange={e=>setClientForm({...clientForm,neighborhood:e.target.value})}/></label>
                  <label>Cidade<input value={clientForm.city} onChange={e=>setClientForm({...clientForm,city:e.target.value})}/></label>
                  <label>UF<input maxLength={2} value={clientForm.state} onChange={e=>setClientForm({...clientForm,state:e.target.value.toUpperCase().slice(0,2)})}/></label>
                </div>
                <p className="permission-note">O endereço completo é necessário para emitir boleto pelo Mercado Pago.</p>
                <button className="primaryBtn" disabled={busy||!canManageFinance}><Plus size={16}/> Cadastrar cliente</button>
                {!canManageFinance&&<p className="permission-note">Seu perfil é somente leitura. Solicite acesso Financeiro ou Administrador para alterar clientes.</p>}
              </form>}
            </section>
            <section className="card info-card"><UsersRound size={26}/><h2>{clients.filter(c=>c.status==='active').length} clientes ativos</h2><p>{planMaxClients?'Seu plano permite até '+planMaxClients+' clientes ativos.':'Seu plano não possui limite definido de clientes.'}</p></section>
          </div>

          <section className="card tableCard">
            <div className="cardHead operational-table-head">
              <div><h2>Lista de clientes</h2><p>{filteredClients.length} registros encontrados</p></div>
              <div className="table-search"><Search size={15}/><input value={clientSearch} onChange={e=>setClientSearch(e.target.value)} placeholder="Buscar cliente..."/></div>
            </div>
            <div className="tableWrap"><table><thead><tr><th>Nome</th><th>Documento</th><th>E-mail</th><th>WhatsApp</th><th>Envio</th><th>Status</th><th>Ações</th></tr></thead><tbody>
              {filteredClients.map(client=><tr key={client.id}>
                <td><strong>{client.name}</strong></td><td>{client.document||'—'}</td><td>{client.email||'—'}</td><td>{client.whatsapp||'—'}</td>
                <td>{client.delivery_preference==='email'?'E-mail':client.delivery_preference==='whatsapp'?'WhatsApp':client.delivery_preference==='both'?'E-mail + WhatsApp':'Manual'}</td>
                <td><span className={'status '+client.status}>{client.status==='active'?'Ativo':'Inativo'}</span></td>
                <td><div className="row-actions">
                  <button disabled={!canManageFinance||busy} onClick={()=>setClientEdit(client)}><Pencil size={13}/> Editar</button>
                  <button disabled={!canManageFinance||busy} onClick={()=>toggleClientStatus(client)}>{client.status==='active'?<XCircle size={13}/>:<CheckCircle2 size={13}/>} {client.status==='active'?'Inativar':'Ativar'}</button>
                </div></td>
              </tr>)}
              {!filteredClients.length&&<tr><td colSpan={7} className="empty">Nenhum cliente encontrado.</td></tr>}
            </tbody></table></div>
          </section>
        </>}

        {!tenantAccessBlocked&&tenantTab==='cobrancas'&&<>
          <div className="tenant-heading"><div><span className="eyebrow">FINANCEIRO</span><h1>Cobranças</h1><p>Crie, edite, filtre e cancele cobranças da sua empresa.</p></div></div>
          <div className="grid">
            <section className="card">
              <h2>{chargeEdit?'Editar cobrança':'Nova cobrança'}</h2>
              {chargeEdit?<form onSubmit={saveChargeEdit}>
                <label>Descrição<input required value={chargeEdit.description} onChange={e=>setChargeEdit({...chargeEdit,description:e.target.value})}/></label>
                <label>Vencimento<input type="date" required value={chargeEdit.due_date} onChange={e=>setChargeEdit({...chargeEdit,due_date:e.target.value})}/></label>
                <div className="form-actions"><button className="primaryBtn" disabled={busy}><Save size={16}/> Salvar cobrança</button><button type="button" className="secondaryBtn" onClick={()=>setChargeEdit(null)}>Cancelar</button></div>
              </form>:<form onSubmit={addCharge}>
                <label>Cliente<select required value={chargeForm.clientId} onChange={e=>setChargeForm({...chargeForm,clientId:e.target.value})}><option value="">Selecione</option>{clients.filter(c=>c.status==='active').map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                <label>Descrição<input required value={chargeForm.description} onChange={e=>setChargeForm({...chargeForm,description:e.target.value})}/></label>
                <div className="cols"><label>Valor<input required placeholder="0,00" value={chargeForm.amount} onChange={e=>setChargeForm({...chargeForm,amount:e.target.value})}/></label><label>Vencimento<input type="date" required value={chargeForm.dueDate} onChange={e=>setChargeForm({...chargeForm,dueDate:e.target.value})}/></label></div>

                <div className="charge-terms">
                  <div className="charge-terms-head">
                    <div><strong>Juros, multa e desconto</strong><span>Configurações opcionais da cobrança</span></div>
                    <small>Use 0,00 para não aplicar</small>
                  </div>

                  <div className="charge-term-block">
                    <div className="charge-term-title"><strong>Juros</strong><span>Aplicado após o vencimento</span></div>
                    <label>Juros ao mês (%)
                      <input inputMode="decimal" placeholder="0,00" value={chargeForm.interestMonthly} onChange={e=>setChargeForm({...chargeForm,interestMonthly:e.target.value})}/>
                    </label>
                  </div>

                  <div className="charge-term-block">
                    <div className="charge-term-title"><strong>Multa</strong><span>Somada ao valor após o vencimento</span></div>
                    <div className="cols">
                      <label>Tipo
                        <select value={chargeForm.fineType} onChange={e=>setChargeForm({...chargeForm,fineType:e.target.value})}>
                          <option value="percent">Percentual</option>
                          <option value="fixed">Valor fixo</option>
                        </select>
                      </label>
                      <label>{chargeForm.fineType==='percent'?'Valor percentual da multa (%)':'Valor fixo da multa (R$)'}
                        <input inputMode="decimal" placeholder="0,00" value={chargeForm.fineValue} onChange={e=>setChargeForm({...chargeForm,fineValue:e.target.value})}/>
                      </label>
                    </div>
                  </div>

                  <div className="charge-term-block">
                    <div className="charge-term-title"><strong>Desconto</strong><span>Incentivo para pagamento antecipado</span></div>
                    <div className="cols">
                      <label>Tipo
                        <select value={chargeForm.discountType} onChange={e=>setChargeForm({...chargeForm,discountType:e.target.value})}>
                          <option value="percent">Percentual</option>
                          <option value="fixed">Valor fixo</option>
                        </select>
                      </label>
                      <label>{chargeForm.discountType==='percent'?'Valor percentual do desconto (%)':'Valor fixo do desconto (R$)'}
                        <input inputMode="decimal" placeholder="0,00" value={chargeForm.discountValue} onChange={e=>setChargeForm({...chargeForm,discountValue:e.target.value})}/>
                      </label>
                    </div>
                    <label>Prazo máximo do desconto
                      <select value={chargeForm.discountDeadlineDays} onChange={e=>setChargeForm({...chargeForm,discountDeadlineDays:e.target.value})}>
                        <option value="0">Até o dia do vencimento</option>
                        <option value="1">Até 1 dia antes do vencimento</option>
                        <option value="3">Até 3 dias antes do vencimento</option>
                        <option value="5">Até 5 dias antes do vencimento</option>
                        <option value="10">Até 10 dias antes do vencimento</option>
                      </select>
                    </label>
                  </div>

                  <p className="permission-note">As condições ficam salvas na cobrança. A aplicação no boleto depende dos recursos suportados pelo banco ou provedor conectado.</p>
                </div>

                <label>Forma de cobrança<select value={chargeForm.paymentMethod} onChange={e=>setChargeForm({...chargeForm,paymentMethod:e.target.value})}>
                  <option value="internal">Registro interno</option>
                  <option value="mercadopago_both" disabled={mercadoPago?.status!=='connected'}>Boleto + Pix Mercado Pago — cliente escolhe{mercadoPago?.status==='connected'?'':' — conectar primeiro'}</option>
                  <option value="mercadopago" disabled={mercadoPago?.status!=='connected'}>Somente boleto Mercado Pago{mercadoPago?.status==='connected'?'':' — conectar primeiro'}</option>
                  <option value="mercadopago_pix" disabled={mercadoPago?.status!=='connected'}>Somente Pix Mercado Pago{mercadoPago?.status==='connected'?'':' — conectar primeiro'}</option>
                </select></label>
                {chargeForm.paymentMethod==='mercadopago_both'&&<p className="permission-note">Serão gerados boleto e Pix para a mesma cobrança. O cliente receberá as duas opções e escolherá como pagar. Para o boleto, mantenha CPF/CNPJ, e-mail e endereço completos.</p>}
                {chargeForm.paymentMethod==='mercadopago'&&<p className="permission-note">O boleto pode vencer entre 1 e 30 dias após a emissão. O cliente precisa ter CPF/CNPJ, e-mail e endereço completo.</p>}
                {chargeForm.paymentMethod==='mercadopago_pix'&&<p className="permission-note">O Pix gera QR Code e código Copia e Cola pelo Mercado Pago. O cliente precisa ter e-mail cadastrado.</p>}
                <button className="primaryBtn" disabled={busy||!clients.some(c=>c.status==='active')||!canManageFinance}><Plus size={16}/> {chargeForm.paymentMethod==='mercadopago_both'?'Gerar boleto + Pix':chargeForm.paymentMethod==='mercadopago_pix'?'Gerar Pix':chargeForm.paymentMethod==='mercadopago'?'Gerar boleto':'Criar cobrança'}</button>
                {!canManageFinance&&<p className="permission-note">Seu perfil é somente leitura para operações financeiras.</p>}
              </form>}
            </section>
            <section className="card info-card"><ReceiptText size={26}/><h2>{openCharges.length} cobranças em aberto</h2><p>Total previsto para recebimento: <strong>{brl(open)}</strong>. Cobranças vencidas são atualizadas automaticamente todos os dias.</p></section>
          </div>

          <section className="card tableCard">
            <div className="cardHead operational-table-head">
              <div><h2>Todas as cobranças</h2><p>{filteredCharges.length} cobranças encontradas</p></div>
              <div className="table-filters">
                <div className="table-search"><Search size={15}/><input value={chargeSearch} onChange={e=>setChargeSearch(e.target.value)} placeholder="Buscar cobrança..."/></div>
                <select value={chargeStatusFilter} onChange={e=>setChargeStatusFilter(e.target.value)}>
                  <option value="all">Todos os status</option><option value="pending">Pendentes</option><option value="paid">Pagas</option><option value="overdue">Vencidas</option><option value="cancelled">Canceladas</option><option value="draft">Rascunhos</option>
                </select>
              </div>
            </div>
            <div className="tableWrap"><table><thead><tr><th>Cliente</th><th>Descrição</th><th>Vencimento</th><th>Status</th><th>Valor</th><th>Ações</th></tr></thead><tbody>
              {filteredCharges.map(charge=>{
                const computedStatus=isComputedOverdue(charge)?'overdue':charge.status;
                return <tr key={charge.id}>
                  <td>{clientName(charge.clients)||'Cliente'}</td><td>{charge.description}</td><td>{dateBR(charge.due_date)}</td>
                  <td><span className={'status '+computedStatus}>{statusLabel[computedStatus]||computedStatus}</span></td><td><strong>{brl(Number(charge.amount_cents))}</strong></td>
                  <td><div className="row-actions">
                    {charge.provider==='mercadopago'&&!charge.boleto_url&&['draft','pending'].includes(computedStatus)&&<button disabled={!canManageFinance||busy||mercadoPago?.status!=='connected'} onClick={()=>retryMercadoPagoBoleto(charge)}><ReceiptText size={13}/> {charge.payment_method==='pix'?'Gerar Pix':charge.payment_method==='boleto_pix'?'Gerar boleto + Pix':'Gerar boleto'}</button>}
                    {['pending','draft','overdue'].includes(computedStatus)&&<button disabled={!canManageFinance||busy} onClick={()=>setChargeEdit({id:charge.id,description:charge.description,due_date:charge.due_date})}><Pencil size={13}/> Editar</button>}
                    {['pending','draft','overdue'].includes(computedStatus)&&<button disabled={!canManageFinance||busy} onClick={()=>cancelChargeAction(charge)}><XCircle size={13}/> Cancelar</button>}
                    {charge.boleto_url&&<a className="table-link" href={charge.boleto_url} target="_blank" rel="noreferrer">{charge.payment_method==='pix'?'Abrir Pix':'Abrir boleto'}</a>}
                    {charge.digitable_line&&<button onClick={()=>navigator.clipboard.writeText(charge.digitable_line||'')}>{charge.payment_method==='pix'?'Copiar Pix':'Copiar linha'}</button>}
                    {charge.payment_method==='boleto_pix'&&charge.pix_url&&<a className="table-link" href={charge.pix_url} target="_blank" rel="noreferrer">Abrir Pix</a>}
                    {charge.payment_method==='boleto_pix'&&charge.pix_code&&<button onClick={()=>navigator.clipboard.writeText(charge.pix_code||'')}>Copiar Pix</button>}
                    {(charge.boleto_url||charge.pix_url)&&chargeClient(charge)?.email&&<button disabled={busy} onClick={()=>openEmailCharge(charge)}><Mail size={13}/> Enviar e-mail</button>}
                    {(charge.boleto_url||charge.pix_url)&&chargeClient(charge)?.whatsapp&&<button onClick={()=>openWhatsAppCharge(charge)}><MessageCircle size={13}/> WhatsApp</button>}
                  </div></td>
                </tr>
              })}
              {!filteredCharges.length&&<tr><td colSpan={6} className="empty">Nenhuma cobrança encontrada.</td></tr>}
            </tbody></table></div>
          </section>
        </>}

        {!tenantAccessBlocked&&tenantTab==='recorrencias'&&<>
          <div className="tenant-heading"><div><span className="eyebrow">AUTOMAÇÃO</span><h1>Recorrências</h1><p>As regras ativas são processadas automaticamente pelo sistema todos os dias.</p></div></div>
          <div className="grid">
            <section className="card"><h2>Nova recorrência</h2><form onSubmit={addRecurring}>
              <label>Cliente<select required value={recurringForm.clientId} onChange={e=>setRecurringForm({...recurringForm,clientId:e.target.value})}><option value="">Selecione</option>{clients.filter(c=>c.status==='active').map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label>Descrição<input required value={recurringForm.description} onChange={e=>setRecurringForm({...recurringForm,description:e.target.value})}/></label>
              <div className="cols"><label>Valor<input required placeholder="0,00" value={recurringForm.amount} onChange={e=>setRecurringForm({...recurringForm,amount:e.target.value})}/></label><label>Frequência<select value={recurringForm.frequency} onChange={e=>setRecurringForm({...recurringForm,frequency:e.target.value})}><option value="monthly">Mensal</option><option value="biweekly">Quinzenal</option><option value="quarterly">Trimestral</option><option value="annual">Anual</option></select></label></div>
              <div className="cols"><label>Dia de geração<input type="number" min="1" max="28" value={recurringForm.generationDay} onChange={e=>setRecurringForm({...recurringForm,generationDay:e.target.value})}/></label><label>Dia do vencimento<input type="number" min="1" max="28" value={recurringForm.dueDay} onChange={e=>setRecurringForm({...recurringForm,dueDay:e.target.value})}/></label></div>
              <button className="primaryBtn" disabled={busy||!clients.some(c=>c.status==='active')||!canManageFinance}><Plus size={16}/> Criar recorrência</button>
              {!canManageFinance&&<p className="permission-note">Seu perfil não permite alterar recorrências.</p>}
            </form></section>
            <section className="card info-card"><CalendarClock size={26}/><h2>{recurring.filter(r=>r.status==='active').length} recorrências ativas</h2><p>Mensais, quinzenais, trimestrais e anuais são geradas automaticamente, sem precisar abrir o sistema.</p></section>
          </div>
          <section className="card tableCard"><div className="cardHead"><div><h2>Cobranças recorrentes</h2><p>Regras cadastradas e status de automação</p></div></div><div className="tableWrap"><table><thead><tr><th>Cliente</th><th>Descrição</th><th>Frequência</th><th>Vencimento</th><th>Status</th><th>Valor</th><th>Ações</th></tr></thead><tbody>
            {recurring.map(r=><tr key={r.id}>
              <td>{clientName(r.clients)||'Cliente'}</td><td>{r.description}</td><td>{frequencyLabel[r.frequency]||r.frequency}</td><td>Dia {r.due_day}</td><td><span className={'status '+r.status}>{statusLabel[r.status]||r.status}</span></td><td>{brl(Number(r.amount_cents))}</td>
              <td><div className="row-actions">
                {r.status==='active'&&<button disabled={!canManageFinance||busy} onClick={()=>setRecurringStatusAction(r.id,'paused')}><PauseCircle size={13}/> Pausar</button>}
                {r.status==='paused'&&<button disabled={!canManageFinance||busy} onClick={()=>setRecurringStatusAction(r.id,'active')}><PlayCircle size={13}/> Ativar</button>}
                {r.status!=='cancelled'&&<button disabled={!canManageFinance||busy} onClick={()=>setRecurringStatusAction(r.id,'cancelled')}><XCircle size={13}/> Cancelar</button>}
              </div></td>
            </tr>)}{!recurring.length&&<tr><td colSpan={7} className="empty">Nenhuma recorrência cadastrada.</td></tr>}
          </tbody></table></div></section>
        </>}

        {!tenantAccessBlocked&&tenantTab==='conta_digital'&&<>
          <div className="tenant-heading digital-account-heading">
            <div><span className="eyebrow">CONTA DIGITAL</span><h1>Conta digital JP</h1><p>Saldo e Pix reais operados pelo Asaas, sem precisar sair do JP Sistema.</p></div>
            <span className={'status '+(baasConnected?'active':'pending')}>{baasConnected?'Asaas conectado':'Ativar conta Asaas'}</span>
          </div>

          {!baasConnected&&<section className="card asaas-onboarding-card">
            <div className="cardHead digital-card-head">
              <div><h2>Ativar Conta Digital Asaas</h2><p>Cria uma subconta separada para esta empresa no BaaS do Asaas.</p></div>
              <Landmark size={21}/>
            </div>
            <div className="provider-note">
              <ShieldCheck size={18}/><p>Estamos usando o ambiente Sandbox. Nenhum dinheiro real será movimentado durante os testes. A chave da subconta será armazenada criptografada no servidor.</p>
            </div>
            {canManageTeam?<form onSubmit={createAsaasAccount} className="asaas-onboarding-form">
              <div className="cols">
                <label>Nome / Razão social<input required value={asaasAccountForm.name} onChange={e=>setAsaasAccountForm({...asaasAccountForm,name:e.target.value})}/></label>
                <label>E-mail<input type="email" required value={asaasAccountForm.email} onChange={e=>setAsaasAccountForm({...asaasAccountForm,email:e.target.value})}/></label>
              </div>
              <div className="cols">
                <label>CPF ou CNPJ<input required value={asaasAccountForm.cpfCnpj} onChange={e=>setAsaasAccountForm({...asaasAccountForm,cpfCnpj:e.target.value})} placeholder="Somente números ou formatado"/></label>
                <label>Celular<input required value={asaasAccountForm.mobilePhone} onChange={e=>setAsaasAccountForm({...asaasAccountForm,mobilePhone:e.target.value})} placeholder="DDD + número"/></label>
              </div>
              {asaasAccountForm.cpfCnpj.replace(/\D/g,'').length===14?<div className="cols">
                <label>Tipo de empresa<select value={asaasAccountForm.companyType} onChange={e=>setAsaasAccountForm({...asaasAccountForm,companyType:e.target.value})}>
                  <option value="MEI">MEI</option><option value="LIMITED">Limitada</option><option value="INDIVIDUAL">Empresário individual</option><option value="ASSOCIATION">Associação</option>
                </select></label>
                <label>Regime tributário<select value={asaasAccountForm.taxRegime} onChange={e=>setAsaasAccountForm({...asaasAccountForm,taxRegime:e.target.value})}>
                  <option value="UNKNOWN">Não informar</option><option value="MEI">MEI</option><option value="NATIONAL_SIMPLE">Simples Nacional</option><option value="NORMAL_REGIME">Regime normal</option>
                </select></label>
              </div>:asaasAccountForm.cpfCnpj.replace(/\D/g,'').length===11?<label>Data de nascimento<input type="date" required value={asaasAccountForm.birthDate} onChange={e=>setAsaasAccountForm({...asaasAccountForm,birthDate:e.target.value})}/></label>:null}
              <label>Faturamento / renda mensal<input required value={asaasAccountForm.incomeValue} onChange={e=>setAsaasAccountForm({...asaasAccountForm,incomeValue:e.target.value})} placeholder="0,00"/></label>
              <div className="cols">
                <label>Endereço<input required value={asaasAccountForm.address} onChange={e=>setAsaasAccountForm({...asaasAccountForm,address:e.target.value})} placeholder="Rua / Avenida"/></label>
                <label>Número<input required value={asaasAccountForm.addressNumber} onChange={e=>setAsaasAccountForm({...asaasAccountForm,addressNumber:e.target.value})}/></label>
              </div>
              <div className="cols">
                <label>Bairro<input required value={asaasAccountForm.province} onChange={e=>setAsaasAccountForm({...asaasAccountForm,province:e.target.value})}/></label>
                <label>CEP<input required value={asaasAccountForm.postalCode} onChange={e=>setAsaasAccountForm({...asaasAccountForm,postalCode:e.target.value})} placeholder="00000-000"/></label>
              </div>
              <label>Complemento<input value={asaasAccountForm.complement} onChange={e=>setAsaasAccountForm({...asaasAccountForm,complement:e.target.value})} placeholder="Opcional"/></label>
              <button className="primaryBtn" disabled={busy}><Landmark size={16}/> {busy?'Ativando...':'Criar conta Asaas de teste'}</button>
              <p className="permission-note">O Asaas exige esses dados para criar a subconta e realizar o onboarding cadastral.</p>
            </form>:<p className="permission-note">Somente Proprietário ou Administrador pode ativar a Conta Digital Asaas.</p>}
          </section>}

          <section className="digital-wallet-hero">
            <div className="digital-wallet-balance">
              <span>{baasConnected?'Saldo Asaas disponível':'Saldo interno disponível'}</span>
              <strong>{brl(accountBalanceCents)}</strong>
              <small>{baasConnected?'Este é o saldo consultado diretamente na conta Asaas desta empresa.':'Até a conta Asaas ser ativada, este valor é apenas o controle interno do sistema.'}</small>
              {baasConnected&&<button type="button" className="wallet-refresh" onClick={refreshAsaasBalance} disabled={busy}><RefreshCw size={14}/> Atualizar saldo</button>}
            </div>
            <div className="digital-wallet-identity">
              <div><span>Provedor financeiro</span><strong>{baasConnected?'Asaas':'Ainda não conectado'}</strong></div>
              <div><span>Wallet ID Asaas</span><strong>{asaasWalletId||'—'}</strong>{asaasWalletId&&<button type="button" className="wallet-copy" onClick={()=>navigator.clipboard.writeText(String(asaasWalletId))}>Copiar</button>}</div>
              <div><span>Conta JP</span><strong>{wallet?.account_number??'—'}</strong></div>
              <p>{baasConnected?'O dinheiro real permanece na conta Asaas. O JP consulta o saldo e envia as ordens de Pix pela API.':'Ative a subconta Asaas para transformar esta área em uma conta digital operacional.'}</p>
            </div>
          </section>

          <div className="grid digital-account-grid">
            <section className="card pix-transfer-card">
              <div className="cardHead digital-card-head">
                <div><h2>Fazer Pix</h2><p>Envie o saldo Asaas para uma chave Pix de qualquer banco.</p></div>
                <Send size={20}/>
              </div>
              <form onSubmit={submitPixTransfer}>
                <label>Nome do destinatário<input required disabled={!baasConnected||!canManageFinance} value={pixTransferForm.recipientName} onChange={e=>setPixTransferForm({...pixTransferForm,recipientName:e.target.value})} placeholder="Nome de quem vai receber"/></label>
                <label>Chave Pix<input required disabled={!baasConnected||!canManageFinance} value={pixTransferForm.destinationKey} onChange={e=>setPixTransferForm({...pixTransferForm,destinationKey:e.target.value})} placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"/></label>
                <div className="cols">
                  <label>Valor<input required disabled={!baasConnected||!canManageFinance} value={pixTransferForm.amount} onChange={e=>setPixTransferForm({...pixTransferForm,amount:e.target.value})} placeholder="0,00"/></label>
                  <label>Descrição<input disabled={!baasConnected||!canManageFinance} value={pixTransferForm.description} onChange={e=>setPixTransferForm({...pixTransferForm,description:e.target.value})} placeholder="Opcional"/></label>
                </div>
                <button className="primaryBtn" disabled={!baasConnected||busy||!canManageFinance}><Send size={16}/> Enviar Pix pelo Asaas</button>
                {!baasConnected&&<p className="permission-note">Ative a Conta Digital Asaas acima para habilitar transferências Pix.</p>}
                {!canManageFinance&&<p className="permission-note">Seu perfil é somente leitura para operações financeiras.</p>}
              </form>
            </section>

            <section className="card receive-pix-card">
              <div className="cardHead digital-card-head"><div><h2>Recebimentos</h2><p>Onde o dinheiro fica e como ele aparece no JP.</p></div><ArrowDownLeft size={20}/></div>
              <div className="digital-receive-info">
                <div><span>Conta Digital</span><strong>{baasConnected?'Asaas ativa':'Aguardando ativação'}</strong></div>
                <div><span>Saldo real</span><strong>{baasConnected?brl(accountBalanceCents):'—'}</strong></div>
                <div><span>Mercado Pago</span><strong>{mercadoPagoConnected?'Conectado separadamente':'Não conectado'}</strong></div>
              </div>
              <div className="provider-note">
                <ShieldCheck size={18}/><p>{baasConnected?'O saldo desta Conta Digital vem do Asaas. Valores recebidos pelo Mercado Pago continuam no Mercado Pago e não são transferidos automaticamente para o Asaas.':'Depois de ativar o Asaas, podemos também emitir cobranças Asaas para que os recebimentos caiam diretamente neste saldo.'}</p>
              </div>
            </section>
          </div>

          <section className="card tableCard">
            <div className="cardHead"><div><h2>Extrato do JP</h2><p>Movimentações registradas no sistema.</p></div><span className="wallet-count">{walletTransactions.length} movimentações</span></div>
            <div className="tableWrap"><table><thead><tr><th>Data</th><th>Movimento</th><th>Descrição</th><th>Origem / destino</th><th>Valor</th></tr></thead><tbody>
              {walletTransactions.map(tx=><tr key={tx.id}>
                <td>{new Date(tx.created_at).toLocaleString('pt-BR')}</td>
                <td><span className={'wallet-direction '+tx.direction}>{tx.direction==='credit'?<><ArrowDownLeft size={13}/> Entrada</>:<><ArrowUpRight size={13}/> Saída</>}</span></td>
                <td>{tx.description}</td><td>{tx.counterpart||'—'}</td>
                <td className={tx.direction==='credit'?'wallet-value credit':'wallet-value debit'}>{tx.direction==='credit'?'+ ':'- '}{brl(Number(tx.amount_cents))}</td>
              </tr>)}
              {!walletTransactions.length&&<tr><td colSpan={5} className="empty">Ainda não há movimentações registradas.</td></tr>}
            </tbody></table></div>
          </section>

          <section className="card tableCard">
            <div className="cardHead"><div><h2>Transferências Pix</h2><p>Histórico das transferências enviadas pela Conta Digital Asaas.</p></div></div>
            <div className="tableWrap"><table><thead><tr><th>Data</th><th>Destinatário</th><th>Chave</th><th>Status</th><th>Valor</th></tr></thead><tbody>
              {walletTransfers.map(t=><tr key={t.id}>
                <td>{new Date(t.created_at).toLocaleString('pt-BR')}</td><td>{t.recipient_name}</td><td>{t.destination_key}</td>
                <td><span className={'status '+(t.status==='completed'?'active':t.status)}>{t.status==='completed'?'Concluída':statusLabel[t.status]||t.status}</span></td>
                <td><strong>{brl(Number(t.amount_cents)+Number(t.fee_cents||0))}</strong></td>
              </tr>)}
              {!walletTransfers.length&&<tr><td colSpan={5} className="empty">Nenhuma transferência Pix realizada.</td></tr>}
            </tbody></table></div>
          </section>
        </>}

        {!tenantAccessBlocked&&tenantTab==='integracoes'&&<>
          <div className="tenant-heading"><div><span className="eyebrow">PAGAMENTOS</span><h1>Integrações</h1><p>Conecte os meios de recebimento usados pela sua empresa.</p></div></div>
          <section className="card provider-card digital-provider-card">
            <div className="provider-card-head">
              <div className="provider-logo digital-bank"><WalletCards size={20}/></div>
              <div><h2>Conta Digital (BaaS)</h2><p>Conta de pagamento integrada ao JP Sistema para receber, consultar saldo e enviar Pix sem entrar no site do banco.</p></div>
              <span className={'status '+(financialProviderConnected?'active':'pending')}>{mercadoPagoConnected?'Mercado Pago conectado':baasConnected?'Conectada':'Estrutura pronta'}</span>
            </div>
            <div className="provider-details">
              <div><span>Modelo</span><strong>Banking as a Service</strong></div>
              <div><span>Conta JP</span><strong>{wallet?.account_number??'—'}</strong></div>
              <div><span>Próxima etapa</span><strong>{mercadoPagoConnected?'Habilitar Payouts para Pix de saída':baasConnected?'Operação bancária ativa':'Conectar um provedor financeiro'}</strong></div>
            </div>
            <div className="provider-note">
              <ShieldCheck size={18}/><p>{mercadoPagoConnected?'A conta Mercado Pago já está conectada para cobranças. Para usar o saldo em transferências Pix dentro do JP, vamos configurar a API Payouts do Mercado Pago.':'A interface da conta digital já está preparada. Para movimentar dinheiro de verdade, precisamos conectar uma instituição financeira parceira.'}</p>
            </div>
            <div className="provider-actions">
              <button className="primaryBtn" onClick={()=>setTenantTab('conta_digital')}><WalletCards size={16}/> Abrir Conta Digital</button>
            </div>
          </section>
          <section className="card provider-card">
            <div className="provider-card-head">
              <div className="provider-logo mp">MP</div>
              <div><h2>Mercado Pago</h2><p>Emita boletos registrados e receba a confirmação de pagamento automaticamente.</p></div>
              <span className={'status '+(mercadoPago?.status==='connected'?'active':'inactive')}>{mercadoPago?.status==='connected'?'Conectado':'Não conectado'}</span>
            </div>
            <div className="provider-details">
              <div><span>Modelo</span><strong>Conta própria da empresa</strong></div>
              <div><span>Conta Mercado Pago</span><strong>{mercadoPago?.external_account_id||'—'}</strong></div>
              <div><span>Conectado em</span><strong>{mercadoPago?.connected_at?new Date(mercadoPago.connected_at).toLocaleString('pt-BR'):'—'}</strong></div>
            </div>
            <div className="provider-note">
              <ShieldCheck size={18}/><p>O acesso é feito por OAuth. A empresa autoriza o JP Sistema de Cobrança sem compartilhar a senha da conta Mercado Pago.</p>
            </div>
            <div className="provider-actions">
              {mercadoPago?.status==='connected'
                ?<button className="secondaryBtn" disabled={!canManageTeam||busy} onClick={disconnectMercadoPago}>Desconectar Mercado Pago</button>
                :<button className="primaryBtn" disabled={!canManageTeam||busy} onClick={connectMercadoPago}>Conectar Mercado Pago</button>}
            </div>
            {!canManageTeam&&<p className="permission-note">Somente Proprietário ou Administrador pode conectar ou desconectar integrações.</p>}
          </section>
          <section className="card provider-card">
            <div className="provider-card-head">
              <div className="provider-logo itau">I</div>
              <div><h2>Itaú</h2><p>Emissão de boletos registrados e Bolecode pela conta bancária da própria empresa.</p></div>
              <span className="status pending">Aguardando configuração</span>
            </div>
            <div className="provider-details">
              <div><span>Modelo</span><strong>Conta própria da empresa</strong></div>
              <div><span>Produto</span><strong>Cobrança / Bolecode</strong></div>
              <div><span>Segurança</span><strong>mTLS + certificado</strong></div>
            </div>
            <div className="provider-note itau-note">
              <ShieldCheck size={18}/><p>A integração do Itaú exige credenciais da empresa e certificado para autenticação mTLS. Assim que a contratação e as credenciais forem liberadas, habilitaremos o cadastro seguro por empresa.</p>
            </div>
            <div className="provider-actions">
              <button className="secondaryBtn" disabled>Aguardando credenciais do Itaú</button>
            </div>
          </section>
          <section className="card integration-help">
            <h2>Como funciona o boleto Mercado Pago</h2>
            <div className="integration-steps">
              <div><b>1</b><span>Cadastre o cliente com CPF/CNPJ, e-mail e endereço completo.</span></div>
              <div><b>2</b><span>Escolha “Boleto Mercado Pago” ou “Pix Mercado Pago”.</span></div>
              <div><b>3</b><span>No boleto, o sistema recebe link e linha digitável; no Pix, recebe QR Code e Copia e Cola.</span></div>
              <div><b>4</b><span>Quando o Mercado Pago confirmar o pagamento, a cobrança muda para “Pago” automaticamente.</span></div>
            </div>
          </section>
        </>}

        {!tenantAccessBlocked&&tenantTab==='equipe'&&<>
          <div className="tenant-heading">
            <div><span className="eyebrow">ACESSOS</span><h1>Equipe</h1><p>Controle quem pode administrar, operar ou apenas consultar os dados da empresa.</p></div>
            <div className="usage-pill"><span>Usuários do plano</span><strong>{teamMembers.length}{planMaxUsers?'/'+planMaxUsers:''}</strong></div>
          </div>

          <div className="grid">
            <section className="card">
              <h2>Adicionar usuário</h2>
              {canManageTeam?<form onSubmit={inviteMember}>
                <label>E-mail do usuário<input type="email" required value={inviteForm.email} onChange={e=>setInviteForm({...inviteForm,email:e.target.value})} placeholder="usuario@empresa.com.br"/></label>
                <label>Perfil<select value={inviteForm.role} onChange={e=>setInviteForm({...inviteForm,role:e.target.value})}>
                  <option value="viewer">Consulta</option><option value="finance">Financeiro</option><option value="admin">Administrador</option>
                </select></label>
                <button className="primaryBtn" disabled={busy}><Plus size={16}/> Adicionar / convidar</button>
                <p className="permission-note">Se o e-mail já tiver uma conta, o acesso é liberado imediatamente. Caso contrário, a pessoa deve criar a conta usando exatamente o e-mail convidado.</p>
              </form>:<div className="read-only-box"><ShieldCheck size={22}/><strong>Gerenciamento restrito</strong><p>Somente Proprietário e Administrador podem convidar ou remover usuários.</p></div>}
            </section>
            <section className="card team-role-guide">
              <h2>Perfis de acesso</h2>
              <div><strong>Administrador</strong><span>Gerencia equipe, clientes, cobranças e configurações operacionais.</span></div>
              <div><strong>Financeiro</strong><span>Gerencia clientes, cobranças e recorrências, sem administrar a equipe.</span></div>
              <div><strong>Consulta</strong><span>Visualiza informações, mas não pode alterar dados financeiros.</span></div>
            </section>
          </div>

          <section className="card tableCard">
            <div className="cardHead"><div><h2>Usuários da empresa</h2><p>{teamMembers.length} acessos ativos</p></div></div>
            <div className="tableWrap"><table><thead><tr><th>Usuário</th><th>E-mail</th><th>Perfil</th><th>Desde</th><th>Ações</th></tr></thead><tbody>
              {teamMembers.map(member=><tr key={member.user_id}>
                <td><strong>{member.display_name||'Usuário'}</strong></td><td>{member.email||'—'}</td>
                <td>{member.role==='owner'?<span className="status active">Proprietário</span>:canManageTeam?<select value={member.role==='member'?'viewer':member.role} onChange={e=>setMemberRoleAction(member.user_id,e.target.value)} disabled={busy}><option value="viewer">Consulta</option><option value="finance">Financeiro</option><option value="admin">Administrador</option></select>:roleLabel(member.role)}</td>
                <td>{dateBR(member.created_at)}</td>
                <td><div className="row-actions">{member.role!=='owner'&&canManageTeam&&<button disabled={busy} onClick={()=>removeMemberAction(member)}><Trash2 size={13}/> Remover</button>}</div></td>
              </tr>)}
              {!teamMembers.length&&<tr><td colSpan={5} className="empty">Nenhum usuário encontrado.</td></tr>}
            </tbody></table></div>
          </section>

          {canManageTeam&&<section className="card tableCard">
            <div className="cardHead"><div><h2>Convites pendentes</h2><p>Cadastros aguardando o usuário criar a conta</p></div></div>
            <div className="tableWrap"><table><thead><tr><th>E-mail</th><th>Perfil</th><th>Enviado em</th><th>Ação</th></tr></thead><tbody>
              {orgInvites.map(invite=><tr key={invite.id}><td>{invite.email}</td><td>{roleLabel(invite.role)}</td><td>{dateBR(invite.created_at)}</td><td><div className="row-actions"><button disabled={busy} onClick={()=>cancelInviteAction(invite)}><XCircle size={13}/> Cancelar convite</button></div></td></tr>)}
              {!orgInvites.length&&<tr><td colSpan={4} className="empty">Nenhum convite pendente.</td></tr>}
            </tbody></table></div>
          </section>}
        </>}

        {!tenantAccessBlocked&&tenantTab==='atividade'&&<>
          <div className="tenant-heading"><div><span className="eyebrow">AUDITORIA</span><h1>Atividade</h1><p>Histórico das principais alterações feitas dentro da empresa.</p></div></div>
          <section className="card tableCard">
            <div className="cardHead"><div><h2>Eventos recentes</h2><p>Registro automático de clientes, cobranças, recorrências, usuários e assinatura.</p></div></div>
            <div className="tableWrap"><table><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Item</th></tr></thead><tbody>
              {tenantAudit.map(item=><tr key={item.id}>
                <td>{new Date(item.created_at).toLocaleString('pt-BR')}</td>
                <td>{item.actor_name||item.actor_email||'Sistema'}</td>
                <td>{auditActionLabel(item.action)}</td>
                <td>{entityLabel(item.entity_type)}{item.entity_id?' · '+item.entity_id.slice(0,8):''}</td>
              </tr>)}
              {!tenantAudit.length&&<tr><td colSpan={4} className="empty">Ainda não há atividades registradas.</td></tr>}
            </tbody></table></div>
          </section>
        </>}

        {!tenantAccessBlocked&&tenantTab==='relatorios'&&<>
          <div className="tenant-heading"><div><span className="eyebrow">ANÁLISE</span><h1>Relatórios</h1><p>Resumo dos principais números da sua empresa.</p></div></div>
          <section className="metrics"><div className="metric"><span>Total recebido</span><strong>{brl(paid)}</strong><small>cobranças pagas</small></div><div className="metric"><span>Em aberto</span><strong>{brl(open)}</strong><small>aguardando pagamento</small></div><div className="metric"><span>Em atraso</span><strong>{brl(overdue)}</strong><small>requer atenção</small></div></section>
          <section className="card report-placeholder"><BarChart3 size={34}/><h2>Relatório financeiro</h2><p>Os indicadores acima são calculados com os dados reais da sua empresa.</p></section>
        </>}

        {!tenantAccessBlocked&&tenantTab==='assinatura'&&<>
          <div className="tenant-heading"><div><span className="eyebrow">PLANO</span><h1>Assinatura</h1><p>Acompanhe seu plano e período de teste.</p></div></div>
          <div className="subscription-card"><div><span className="eyebrow">{subscription?.status==='trialing'?'TESTE GRÁTIS':'PLANO ATUAL'}</span><h2>{subscription?.status==='trialing'?'4 dias grátis':(planName??'Plano')}</h2><p>{subscription?.status==='trialing'?'Depois do teste você escolhe o plano.':(billingLabel[planBillingModel]||'Mensal')}</p></div><div className="subscription-price">{subscription?.status==='trialing'?(trialDaysLeft+' dia'+(trialDaysLeft===1?'':'s')):<>{planBillingModel!=='per_boleto'&&typeof planPrice==='number'?brl(planPrice):''}{planBillingModel==='hybrid'?' + ':''}{planBillingModel!=='monthly'&&typeof planBoletoFee==='number'?brl(planBoletoFee)+'/boleto':''}</>}</div></div>
          <div className="grid"><section className="card"><h2>Status da assinatura</h2><div className="summary-row"><span>Status</span><span className={'status '+(subscription?.status??'trialing')}>{statusLabel[subscription?.status??'trialing']||subscription?.status}</span></div><div className="summary-row"><span>Teste até</span><strong>{subscription?.trial_ends_at?dateBR(subscription.trial_ends_at):'—'}</strong></div><div className="summary-row"><span>Próximo período</span><strong>{subscription?.current_period_end?dateBR(subscription.current_period_end):'—'}</strong></div></section><section className="card plan-benefits"><h2>Incluído no seu acesso</h2><p>✓ Cadastro de clientes</p><p>✓ Cobranças e recorrências</p><p>✓ Relatórios financeiros</p><p>✓ Separação segura dos dados</p></section></div>
          {subscription?.status==='trialing'&&<section className="card available-plans"><div className="cardHead"><div><h2>Planos disponíveis após o teste</h2><p>Ao terminar os 4 dias grátis, você escolhe uma destas opções.</p></div></div><div className="mini-plan-grid">{plans.filter(p=>p.active).map(p=><div className="mini-plan" key={p.id}><strong>{p.name}</strong><span>{billingLabel[p.billing_model]}</span><b>{p.billing_model!=='per_boleto'?brl(Number(p.monthly_price_cents))+'/mês':''}{p.billing_model==='hybrid'?' + ':''}{p.billing_model!=='monthly'?brl(Number(p.boleto_fee_cents))+'/boleto':''}</b></div>)}</div></section>}
        </>}

        {!tenantAccessBlocked&&tenantTab==='conta'&&<>
          <div className="tenant-heading"><div><span className="eyebrow">CONTA</span><h1>Minha conta</h1><p>Informações da empresa e do seu acesso.</p></div></div>
          <div className="grid"><section className="card account-card"><Settings size={24}/><h2>{org?.name}</h2><div className="summary-row"><span>E-mail</span><strong>{user?.email}</strong></div><div className="summary-row"><span>Perfil</span><strong>{roleLabel(membership?.role)}</strong></div><div className="summary-row"><span>Plano</span><strong>{planName??'—'}</strong></div><div className="summary-row"><span>Status</span><span className={'status '+(subscription?.status??org?.status??'active')}>{statusLabel[subscription?.status??org?.status??'active']||'Ativo'}</span></div></section><section className="card account-card"><WalletCards size={24}/><h2>Conta digital</h2><div className="summary-row"><span>Número da conta</span><strong>{wallet?.account_number??'—'}</strong></div><div className="summary-row"><span>Chave interna</span><strong>{wallet?.pix_key??'—'}</strong></div><div className="summary-row"><span>Saldo</span><strong>{brl(Number(wallet?.balance_cents??0))}</strong></div></section></div>
        </>}
      </main>
    </section>
  </div>;
}
