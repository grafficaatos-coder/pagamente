'use client';

import { useEffect, useMemo, useState } from 'react';
import { LogOut, Plus, RefreshCw, WalletCards } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { brl, dateBR, parseBRL } from '@/lib/format';

type Client={id:string;name:string;document:string|null;email:string|null;whatsapp:string|null};
type Charge={id:string;description:string;amount_cents:number;due_date:string;status:string;clients?:{name?:string}|null};

export default function Home(){
  const {user,signOut}=useAuth();
  const supabase=useMemo(()=>getSupabaseBrowserClient(),[]);
  const [org,setOrg]=useState<any>(null);
  const [wallet,setWallet]=useState<any>(null);
  const [clients,setClients]=useState<Client[]>([]);
  const [charges,setCharges]=useState<Charge[]>([]);
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState('');
  const [clientForm,setClientForm]=useState({name:'',document:'',email:'',whatsapp:''});
  const [chargeForm,setChargeForm]=useState({clientId:'',description:'',amount:'',dueDate:''});

  async function load(){
    if(!supabase||!user)return;
    setBusy(true);setMsg('');
    try{
      const {data:member,error:memberError}=await supabase.from('organization_members').select('organization_id').eq('user_id',user.id).limit(1).maybeSingle();
      if(memberError)throw memberError;
      if(!member){setMsg('Nenhuma empresa vinculada a este usuário.');return}
      const orgId=member.organization_id;
      const [{data:o,error:oe},{data:w,error:we},{data:c,error:ce},{data:ch,error:che}]=await Promise.all([
        supabase.from('organizations').select('id,name,status').eq('id',orgId).single(),
        supabase.from('wallet_accounts').select('id,account_number,pix_key,balance_cents').eq('organization_id',orgId).single(),
        supabase.from('clients').select('id,name,document,email,whatsapp').eq('organization_id',orgId).order('created_at',{ascending:false}),
        supabase.from('charges').select('id,description,amount_cents,due_date,status,clients(name)').eq('organization_id',orgId).order('created_at',{ascending:false}).limit(50)
      ]);
      if(oe||we||ce||che)throw oe||we||ce||che;
      setOrg(o);setWallet(w);setClients(c??[]);setCharges((ch??[]) as any);
      if(!chargeForm.clientId && c?.[0]?.id)setChargeForm(f=>({...f,clientId:c[0].id}));
    }catch(e){setMsg(e instanceof Error?e.message:'Erro ao carregar dados.')}finally{setBusy(false)}
  }

  useEffect(()=>{load()},[user?.id]);

  async function addClient(e:React.FormEvent){
    e.preventDefault(); if(!supabase||!org)return;
    setBusy(true);setMsg('');
    const {error}=await supabase.from('clients').insert({organization_id:org.id,...clientForm,status:'active'});
    if(error)setMsg(error.message); else {setClientForm({name:'',document:'',email:'',whatsapp:''});setMsg('Cliente cadastrado.');await load()}
    setBusy(false);
  }

  async function addCharge(e:React.FormEvent){
    e.preventDefault(); if(!supabase||!org)return;
    const amount=parseBRL(chargeForm.amount);
    if(amount<=0){setMsg('Informe um valor válido.');return}
    setBusy(true);setMsg('');
    const {error}=await supabase.from('charges').insert({
      organization_id:org.id,client_id:chargeForm.clientId,description:chargeForm.description,
      amount_cents:amount,due_date:chargeForm.dueDate,provider:'mock',status:'pending',
      send_email:false,send_whatsapp:false
    });
    if(error)setMsg(error.message); else {setChargeForm(f=>({...f,description:'',amount:'',dueDate:''}));setMsg('Cobrança criada.');await load()}
    setBusy(false);
  }

  const open=charges.filter(c=>['pending','draft','overdue'].includes(c.status)).reduce((s,c)=>s+Number(c.amount_cents),0);

  return <div className="app">
    <header><div className="brand"><WalletCards size={24}/><strong>pagamente</strong></div><div className="user">{org?.name??'Minha empresa'} · {user?.email}<button onClick={load} title="Atualizar"><RefreshCw size={17}/></button><button onClick={()=>signOut()} title="Sair"><LogOut size={17}/></button></div></header>
    <main>
      <div className="heading"><div><h1>Painel financeiro</h1><p>Cobranças, clientes e saldo da sua empresa.</p></div><span className="badge">{org?.status??'carregando'}</span></div>
      {msg&&<div className="notice">{msg}</div>}
      <section className="metrics">
        <div className="metric primary"><span>Saldo disponível</span><strong>{brl(Number(wallet?.balance_cents??0))}</strong><small>{wallet?.account_number??'—'}</small></div>
        <div className="metric"><span>A receber</span><strong>{brl(open)}</strong><small>{charges.filter(c=>['pending','draft','overdue'].includes(c.status)).length} cobranças</small></div>
        <div className="metric"><span>Clientes</span><strong>{clients.length}</strong><small>cadastrados</small></div>
      </section>

      <div className="grid">
        <section className="card"><h2>Nova cobrança</h2><form onSubmit={addCharge}>
          <label>Cliente<select required value={chargeForm.clientId} onChange={e=>setChargeForm({...chargeForm,clientId:e.target.value})}><option value="">Selecione</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Descrição<input required value={chargeForm.description} onChange={e=>setChargeForm({...chargeForm,description:e.target.value})}/></label>
          <div className="cols"><label>Valor<input required placeholder="0,00" value={chargeForm.amount} onChange={e=>setChargeForm({...chargeForm,amount:e.target.value})}/></label><label>Vencimento<input type="date" required value={chargeForm.dueDate} onChange={e=>setChargeForm({...chargeForm,dueDate:e.target.value})}/></label></div>
          <button className="primaryBtn" disabled={busy||!clients.length}><Plus size={16}/> Criar cobrança</button>
        </form></section>

        <section className="card"><h2>Novo cliente</h2><form onSubmit={addClient}>
          <label>Nome / Razão social<input required value={clientForm.name} onChange={e=>setClientForm({...clientForm,name:e.target.value})}/></label>
          <label>CPF / CNPJ<input value={clientForm.document} onChange={e=>setClientForm({...clientForm,document:e.target.value})}/></label>
          <div className="cols"><label>E-mail<input type="email" value={clientForm.email} onChange={e=>setClientForm({...clientForm,email:e.target.value})}/></label><label>WhatsApp<input value={clientForm.whatsapp} onChange={e=>setClientForm({...clientForm,whatsapp:e.target.value})}/></label></div>
          <button className="primaryBtn" disabled={busy}><Plus size={16}/> Cadastrar cliente</button>
        </form></section>
      </div>

      <section className="card tableCard"><div className="cardHead"><div><h2>Cobranças recentes</h2><p>Últimas cobranças registradas</p></div></div>
        <div className="tableWrap"><table><thead><tr><th>Cliente</th><th>Descrição</th><th>Vencimento</th><th>Status</th><th>Valor</th></tr></thead><tbody>
          {charges.map(c=><tr key={c.id}><td>{Array.isArray(c.clients)?c.clients[0]?.name:(c.clients as any)?.name??'Cliente'}</td><td>{c.description}</td><td>{dateBR(c.due_date)}</td><td><span className={'status '+c.status}>{c.status}</span></td><td>{brl(Number(c.amount_cents))}</td></tr>)}
          {!charges.length&&<tr><td colSpan={5} className="empty">{busy?'Carregando…':'Nenhuma cobrança cadastrada.'}</td></tr>}
        </tbody></table></div>
      </section>
    </main>
  </div>
}
