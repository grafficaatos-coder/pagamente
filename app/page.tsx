'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Building2, CalendarClock, CheckCircle2, CircleDollarSign, Clock3, CreditCard, Crown,
  History, LayoutDashboard, LogOut, PauseCircle, Pencil, PlayCircle, Plus, ReceiptText, RefreshCw,
  Save, Search, Settings, Sparkles, ShieldCheck, TrendingUp, TriangleAlert, Trash2,
  UserCircle2, UserCog, UsersRound, WalletCards, XCircle
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { brl, dateBR, parseBRL } from '@/lib/format';

type Client = { id:string; name:string; document:string|null; email:string|null; whatsapp:string|null; status:string };
type Charge = {
  id:string; description:string; amount_cents:number; due_date:string; status:string;
  provider:string; created_at:string; boleto_url?:string|null; digitable_line?:string|null;
  clients?:{name?:string}|null
};
type RecurringRule = { id:string; description:string; amount_cents:number; frequency:string; generation_day:number; due_day:number; status:string; clients?:{name?:string}|null };
type TeamMember = { user_id:string; email:string|null; display_name:string|null; role:string; created_at:string };
type OrgInvite = { id:string; email:string; role:string; status:string; created_at:string };
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

type TenantTab = 'inicio'|'clientes'|'cobrancas'|'recorrencias'|'equipe'|'atividade'|'relatorios'|'assinatura'|'conta';
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

  const [clientForm,setClientForm]=useState({name:'',document:'',email:'',whatsapp:''});
  const [chargeForm,setChargeForm]=useState({clientId:'',description:'',amount:'',dueDate:''});
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
        {data:auditRows,error:tae}
      ]=await Promise.all([
        supabase.from('organizations').select('id,name,status').eq('id',orgId).single(),
        supabase.from('wallet_accounts').select('id,account_number,pix_key,balance_cents').eq('organization_id',orgId).single(),
        supabase.from('clients').select('id,name,document,email,whatsapp,status').eq('organization_id',orgId).order('created_at',{ascending:false}),
        supabase.from('charges').select('id,description,amount_cents,due_date,status,provider,created_at,boleto_url,digitable_line,clients(name)').eq('organization_id',orgId).order('created_at',{ascending:false}).limit(250),
        supabase.from('recurring_rules').select('id,description,amount_cents,frequency,generation_day,due_day,status,clients(name)').eq('organization_id',orgId).order('created_at',{ascending:false}),
        supabase.from('subscriptions').select('status,trial_ends_at,current_period_end,chosen_plan_at,plans(name,billing_model,monthly_price_cents,boleto_fee_cents,max_clients,max_users)').eq('organization_id',orgId).maybeSingle(),
        supabase.from('platform_invoices').select('id,status,total_cents,due_date,reference_month').eq('organization_id',orgId).order('created_at',{ascending:false}).limit(1).maybeSingle(),
        supabase.rpc('tenant_list_members'),
        supabase.rpc('tenant_audit_feed',{p_limit:80})
      ]);
      if(oe||we||ce||che||rre||se||ine||tme||tae)throw oe||we||ce||che||rre||se||ine||tme||tae;

      setOrg(o);setWallet(w);setClients((c??[]) as any);setCharges((ch??[]) as any);
      setRecurring((rr??[]) as any);setSubscription(sub);setPlatformInvoice(invoice);
      setTeamMembers((members??[]) as any);setTenantAudit((auditRows??[]) as any);

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

  useEffect(()=>{load()},[user?.id]);

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
    const {error}=await supabase.from('clients').insert({organization_id:org.id,...clientForm,status:'active'});
    if(error)setMsg(error.message);
    else{setClientForm({name:'',document:'',email:'',whatsapp:''});setMsg('Cliente cadastrado com sucesso.');await load();setTenantTab('clientes')}
    setBusy(false);
  }

  async function addCharge(e:React.FormEvent){
    e.preventDefault();if(!supabase||!org)return;
    const amount=parseBRL(chargeForm.amount);
    if(amount<=0){setMsg('Informe um valor válido.');return}
    setBusy(true);setMsg('');
    const {error}=await supabase.from('charges').insert({
      organization_id:org.id,client_id:chargeForm.clientId,description:chargeForm.description,
      amount_cents:amount,due_date:chargeForm.dueDate,provider:'mock',status:'pending',
      send_email:false,send_whatsapp:false
    });
    if(error)setMsg(error.message);
    else{setChargeForm(f=>({...f,description:'',amount:'',dueDate:''}));setMsg('Cobrança criada com sucesso.');await load();setTenantTab('cobrancas')}
    setBusy(false);
  }

  async function addRecurring(e:React.FormEvent){
    e.preventDefault();if(!supabase||!org)return;
    const amount=parseBRL(recurringForm.amount);
    if(amount<=0){setMsg('Informe um valor válido.');return}
    setBusy(true);setMsg('');
    const {error}=await supabase.from('recurring_rules').insert({
      organization_id:org.id,client_id:recurringForm.clientId,description:recurringForm.description,
      amount_cents:amount,frequency:recurringForm.frequency,generation_day:Number(recurringForm.generationDay),
      due_day:Number(recurringForm.dueDay),provider:'mock',status:'active',send_email:false,send_whatsapp:false
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
    const {error}=await supabase.rpc('cancel_charge',{p_charge_id:charge.id});
    if(error)setMsg(error.message);
    else{setMsg('Cobrança cancelada.');await load()}
    setBusy(false);
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
        <div className="tenant-brand">
          <div className="brand-mark"><ShieldCheck size={21}/></div>
          <div><strong>{platformSettings.platform_name||'Sistema de Cobrança'}</strong><span>Administração da plataforma</span></div>
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
            <div className="tenant-heading"><div><span className="eyebrow">CLIENTES DA PLATAFORMA</span><h1>Empresas</h1><p>Altere plano e status de cada empresa.</p></div></div>
            <section className="card tableCard">
              <div className="cardHead"><div><h2>Empresas cadastradas</h2><p>{platformOrgs.length} contas na plataforma</p></div></div>
              <div className="tableWrap"><table className="admin-table"><thead><tr><th>Empresa</th><th>Plano</th><th>Status</th><th>Boletos no mês</th><th>Teste até</th></tr></thead><tbody>
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
                </tr>)}
              </tbody></table></div>
            </section>
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
    ['recorrencias','Recorrências',CalendarClock],['equipe','Equipe',UserCog],['atividade','Atividade',History],
    ['relatorios','Relatórios',BarChart3],['assinatura','Assinatura',WalletCards],['conta','Minha conta',UserCircle2]
  ] as const;

  return <div className="tenant-shell">
    <aside className="tenant-sidebar">
      <div className="tenant-brand"><div className="brand-mark"><WalletCards size={21}/></div><div><strong>Sistema de Cobrança</strong><span>Área do cliente</span></div></div>
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

        {!needsPlanChoice&&subscription?.status==='trialing'&&!trialExpired&&<div className="trial-banner">
          <div><strong>Teste grátis por 4 dias</strong><span>{trialDaysLeft>1?trialDaysLeft+' dias restantes':trialDaysLeft===1?'1 dia restante':'Último dia do teste'}</span></div>
          <div>Termina em <strong>{trialEnd?dateBR(trialEnd.toISOString()):'—'}</strong>. Depois você poderá escolher o plano.</div>
        </div>}

        {!needsPlanChoice&&tenantTab==='inicio'&&<>
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

        {!needsPlanChoice&&tenantTab==='clientes'&&<>
          <div className="tenant-heading"><div><span className="eyebrow">CADASTROS</span><h1>Clientes</h1><p>Cadastre e acompanhe os clientes da sua empresa.</p></div></div>
          <div className="grid">
            <section className="card"><h2>Novo cliente</h2><form onSubmit={addClient}><label>Nome / Razão social<input required value={clientForm.name} onChange={e=>setClientForm({...clientForm,name:e.target.value})}/></label><label>CPF / CNPJ<input value={clientForm.document} onChange={e=>setClientForm({...clientForm,document:e.target.value})}/></label><div className="cols"><label>E-mail<input type="email" value={clientForm.email} onChange={e=>setClientForm({...clientForm,email:e.target.value})}/></label><label>WhatsApp<input value={clientForm.whatsapp} onChange={e=>setClientForm({...clientForm,whatsapp:e.target.value})}/></label></div><button className="primaryBtn" disabled={busy}><Plus size={16}/> Cadastrar cliente</button></form></section>
            <section className="card info-card"><UsersRound size={26}/><h2>{clients.length} clientes cadastrados</h2><p>Os dados ficam separados por empresa e protegidos pelas regras de acesso.</p></section>
          </div>
          <section className="card tableCard"><div className="cardHead"><div><h2>Lista de clientes</h2><p>Contatos cadastrados</p></div></div><div className="tableWrap"><table><thead><tr><th>Nome</th><th>Documento</th><th>E-mail</th><th>WhatsApp</th></tr></thead><tbody>
            {clients.map(c=><tr key={c.id}><td><strong>{c.name}</strong></td><td>{c.document||'—'}</td><td>{c.email||'—'}</td><td>{c.whatsapp||'—'}</td></tr>)}{!clients.length&&<tr><td colSpan={4} className="empty">Nenhum cliente cadastrado.</td></tr>}
          </tbody></table></div></section>
        </>}

        {!needsPlanChoice&&tenantTab==='cobrancas'&&<>
          <div className="tenant-heading"><div><span className="eyebrow">FINANCEIRO</span><h1>Cobranças</h1><p>Crie e acompanhe as cobranças da sua empresa.</p></div></div>
          <div className="grid">
            <section className="card"><h2>Nova cobrança</h2><form onSubmit={addCharge}><label>Cliente<select required value={chargeForm.clientId} onChange={e=>setChargeForm({...chargeForm,clientId:e.target.value})}><option value="">Selecione</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Descrição<input required value={chargeForm.description} onChange={e=>setChargeForm({...chargeForm,description:e.target.value})}/></label><div className="cols"><label>Valor<input required placeholder="0,00" value={chargeForm.amount} onChange={e=>setChargeForm({...chargeForm,amount:e.target.value})}/></label><label>Vencimento<input type="date" required value={chargeForm.dueDate} onChange={e=>setChargeForm({...chargeForm,dueDate:e.target.value})}/></label></div><button className="primaryBtn" disabled={busy||!clients.length}><Plus size={16}/> Criar cobrança</button></form></section>
            <section className="card info-card"><ReceiptText size={26}/><h2>{openCharges.length} cobranças em aberto</h2><p>Total previsto para recebimento: <strong>{brl(open)}</strong>.</p></section>
          </div>
          <section className="card tableCard"><div className="cardHead"><div><h2>Todas as cobranças</h2><p>Histórico financeiro da empresa</p></div></div><div className="tableWrap"><table><thead><tr><th>Cliente</th><th>Descrição</th><th>Vencimento</th><th>Status</th><th>Valor</th></tr></thead><tbody>
            {charges.map(c=><tr key={c.id}><td>{clientName(c.clients)||'Cliente'}</td><td>{c.description}</td><td>{dateBR(c.due_date)}</td><td><span className={'status '+c.status}>{statusLabel[c.status]||c.status}</span></td><td>{brl(Number(c.amount_cents))}</td></tr>)}{!charges.length&&<tr><td colSpan={5} className="empty">Nenhuma cobrança cadastrada.</td></tr>}
          </tbody></table></div></section>
        </>}

        {!needsPlanChoice&&tenantTab==='recorrencias'&&<>
          <div className="tenant-heading"><div><span className="eyebrow">AUTOMAÇÃO</span><h1>Recorrências</h1><p>Cadastre cobranças que se repetem automaticamente.</p></div></div>
          <div className="grid">
            <section className="card"><h2>Nova recorrência</h2><form onSubmit={addRecurring}><label>Cliente<select required value={recurringForm.clientId} onChange={e=>setRecurringForm({...recurringForm,clientId:e.target.value})}><option value="">Selecione</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Descrição<input required value={recurringForm.description} onChange={e=>setRecurringForm({...recurringForm,description:e.target.value})}/></label><div className="cols"><label>Valor<input required placeholder="0,00" value={recurringForm.amount} onChange={e=>setRecurringForm({...recurringForm,amount:e.target.value})}/></label><label>Frequência<select value={recurringForm.frequency} onChange={e=>setRecurringForm({...recurringForm,frequency:e.target.value})}><option value="monthly">Mensal</option><option value="biweekly">Quinzenal</option><option value="quarterly">Trimestral</option><option value="annual">Anual</option></select></label></div><div className="cols"><label>Dia de geração<input type="number" min="1" max="28" value={recurringForm.generationDay} onChange={e=>setRecurringForm({...recurringForm,generationDay:e.target.value})}/></label><label>Dia do vencimento<input type="number" min="1" max="28" value={recurringForm.dueDay} onChange={e=>setRecurringForm({...recurringForm,dueDay:e.target.value})}/></label></div><button className="primaryBtn" disabled={busy||!clients.length}><Plus size={16}/> Criar recorrência</button></form></section>
            <section className="card info-card"><CalendarClock size={26}/><h2>{recurring.filter(r=>r.status==='active').length} recorrências ativas</h2><p>Use recorrências para mensalidades, contratos e cobranças periódicas.</p></section>
          </div>
          <section className="card tableCard"><div className="cardHead"><div><h2>Cobranças recorrentes</h2><p>Regras cadastradas</p></div></div><div className="tableWrap"><table><thead><tr><th>Cliente</th><th>Descrição</th><th>Frequência</th><th>Vencimento</th><th>Status</th><th>Valor</th></tr></thead><tbody>
            {recurring.map(r=><tr key={r.id}><td>{clientName(r.clients)||'Cliente'}</td><td>{r.description}</td><td>{frequencyLabel[r.frequency]||r.frequency}</td><td>Dia {r.due_day}</td><td><span className={'status '+r.status}>{statusLabel[r.status]||r.status}</span></td><td>{brl(Number(r.amount_cents))}</td></tr>)}{!recurring.length&&<tr><td colSpan={6} className="empty">Nenhuma recorrência cadastrada.</td></tr>}
          </tbody></table></div></section>
        </>}

        {!needsPlanChoice&&tenantTab==='relatorios'&&<>
          <div className="tenant-heading"><div><span className="eyebrow">ANÁLISE</span><h1>Relatórios</h1><p>Resumo dos principais números da sua empresa.</p></div></div>
          <section className="metrics"><div className="metric"><span>Total recebido</span><strong>{brl(paid)}</strong><small>cobranças pagas</small></div><div className="metric"><span>Em aberto</span><strong>{brl(open)}</strong><small>aguardando pagamento</small></div><div className="metric"><span>Em atraso</span><strong>{brl(overdue)}</strong><small>requer atenção</small></div></section>
          <section className="card report-placeholder"><BarChart3 size={34}/><h2>Relatório financeiro</h2><p>Os indicadores acima são calculados com os dados reais da sua empresa.</p></section>
        </>}

        {!needsPlanChoice&&tenantTab==='assinatura'&&<>
          <div className="tenant-heading"><div><span className="eyebrow">PLANO</span><h1>Assinatura</h1><p>Acompanhe seu plano e período de teste.</p></div></div>
          <div className="subscription-card"><div><span className="eyebrow">{subscription?.status==='trialing'?'TESTE GRÁTIS':'PLANO ATUAL'}</span><h2>{subscription?.status==='trialing'?'4 dias grátis':(planName??'Plano')}</h2><p>{subscription?.status==='trialing'?'Depois do teste você escolhe o plano.':(billingLabel[planBillingModel]||'Mensal')}</p></div><div className="subscription-price">{subscription?.status==='trialing'?(trialDaysLeft+' dia'+(trialDaysLeft===1?'':'s')):<>{planBillingModel!=='per_boleto'&&typeof planPrice==='number'?brl(planPrice):''}{planBillingModel==='hybrid'?' + ':''}{planBillingModel!=='monthly'&&typeof planBoletoFee==='number'?brl(planBoletoFee)+'/boleto':''}</>}</div></div>
          <div className="grid"><section className="card"><h2>Status da assinatura</h2><div className="summary-row"><span>Status</span><span className={'status '+(subscription?.status??'trialing')}>{statusLabel[subscription?.status??'trialing']||subscription?.status}</span></div><div className="summary-row"><span>Teste até</span><strong>{subscription?.trial_ends_at?dateBR(subscription.trial_ends_at):'—'}</strong></div><div className="summary-row"><span>Próximo período</span><strong>{subscription?.current_period_end?dateBR(subscription.current_period_end):'—'}</strong></div></section><section className="card plan-benefits"><h2>Incluído no seu acesso</h2><p>✓ Cadastro de clientes</p><p>✓ Cobranças e recorrências</p><p>✓ Relatórios financeiros</p><p>✓ Separação segura dos dados</p></section></div>
          {subscription?.status==='trialing'&&<section className="card available-plans"><div className="cardHead"><div><h2>Planos disponíveis após o teste</h2><p>Ao terminar os 4 dias grátis, você escolhe uma destas opções.</p></div></div><div className="mini-plan-grid">{plans.filter(p=>p.active).map(p=><div className="mini-plan" key={p.id}><strong>{p.name}</strong><span>{billingLabel[p.billing_model]}</span><b>{p.billing_model!=='per_boleto'?brl(Number(p.monthly_price_cents))+'/mês':''}{p.billing_model==='hybrid'?' + ':''}{p.billing_model!=='monthly'?brl(Number(p.boleto_fee_cents))+'/boleto':''}</b></div>)}</div></section>}
        </>}

        {!needsPlanChoice&&tenantTab==='conta'&&<>
          <div className="tenant-heading"><div><span className="eyebrow">CONTA</span><h1>Minha conta</h1><p>Informações da empresa e do seu acesso.</p></div></div>
          <div className="grid"><section className="card account-card"><Settings size={24}/><h2>{org?.name}</h2><div className="summary-row"><span>E-mail</span><strong>{user?.email}</strong></div><div className="summary-row"><span>Perfil</span><strong>{membership?.role==='owner'?'Administrador da empresa':membership?.role==='admin'?'Gestor':'Usuário'}</strong></div><div className="summary-row"><span>Plano</span><strong>{planName??'—'}</strong></div><div className="summary-row"><span>Status</span><span className={'status '+(subscription?.status??org?.status??'active')}>{statusLabel[subscription?.status??org?.status??'active']||'Ativo'}</span></div></section><section className="card account-card"><WalletCards size={24}/><h2>Conta digital</h2><div className="summary-row"><span>Número da conta</span><strong>{wallet?.account_number??'—'}</strong></div><div className="summary-row"><span>Chave interna</span><strong>{wallet?.pix_key??'—'}</strong></div><div className="summary-row"><span>Saldo</span><strong>{brl(Number(wallet?.balance_cents??0))}</strong></div></section></div>
        </>}
      </main>
    </section>
  </div>;
}
