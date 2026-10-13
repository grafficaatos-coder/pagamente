import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/mercadopago-plan-choice.js';

const business='11111111-1111-4111-8111-111111111111';
const owner='22222222-2222-4222-8222-222222222222';
const original='33333333-3333-4333-8333-333333333333';
const professional='44444444-4444-4444-8444-444444444444';
const env={AGENDA_SUPABASE_URL:process.env.AGENDA_SUPABASE_URL,AGENDA_SUPABASE_SECRET_KEY:process.env.AGENDA_SUPABASE_SECRET_KEY};
const savedFetch=globalThis.fetch;
test.after(()=>{
  globalThis.fetch=savedFetch;
  for(const [k,v] of Object.entries(env)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
});

async function scenario({paid=true,role='owner',visible=true,linked=false,selected=professional,existingChoice=null}={}){
  process.env.AGENDA_SUPABASE_URL='https://example.supabase.co';
  process.env.AGENDA_SUPABASE_SECRET_KEY='test_service_key_for_mocks_only';
  const patches=[];
  let reads=0;
  globalThis.fetch=async(input,options={})=>{
    const u=new URL(input);const path=u.pathname;
    let payload=null;
    if(path==='/auth/v1/user')payload={id:owner};
    else if(path==='/rest/v1/agenda_members')payload=[{role}];
    else if(path==='/rest/v1/agenda_plans')payload=[{id:selected,name:'Profissional',active:true,visible,monthly_price_cents:9990}];
    else if(path==='/rest/v1/agenda_subscriptions'){
      if(options.method==='PATCH'){
        patches.push(JSON.parse(options.body));
        payload=[{business_id:business}];
      }else payload=[{plan_id:original,status:'active',mp_preapproval_id:linked?'MP123':null,
        current_period_end:new Date(Date.now()+30*86400000).toISOString(),
        mp_last_payment_at:paid?new Date(Date.now()-86400000).toISOString():null,
        requested_plan_id:existingChoice}];
    }else if(path==='/rest/v1/agenda_businesses')payload=[{manual_blocked:false}];
    else if(path==='/rest/v1/agenda_mp_pix_charges')payload=[];
    else throw new Error('Unexpected mock HTTP '+path);
    reads++;
    return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const req={method:'POST',headers:{authorization:'Bearer test_user_token'},
    body:{business_id:business,plan_id:selected}};
  const res={statusCode:200,body:null,setHeader(){return this},
    status(n){this.statusCode=n;return this},json(d){this.body=d;return this}};
  await handler(req,res);
  return {status:res.statusCode,body:res.body,patches,reads};
}

test('Mês já pago: selecionar outro plano só agenda, não cobra nem muda plano',async()=>{
  const r=await scenario();
  assert.equal(r.status,200);
  assert.equal(r.body.scheduled,true);
  assert.equal(r.body.ready_to_pay,false);
  assert.equal(r.body.amount_cents,9990);
  assert.deepEqual(r.patches.map(x=>x.requested_plan_id),[professional]);
  assert.equal(Object.hasOwn(r.patches[0],'plan_id'),false);
});

test('Cancelar uma troca: manter plano atual remove a solicitação',async()=>{
  const r=await scenario({selected:original,existingChoice:professional});
  assert.equal(r.status,200);
  assert.equal(r.body.scheduled,false);
  assert.deepEqual(r.patches.map(x=>x.requested_plan_id),[null]);
});

test('Sem mês pago: pode contratar o plano escolhido após pagamento',async()=>{
  const r=await scenario({paid:false});
  assert.equal(r.status,200);
  assert.equal(r.body.ready_to_pay,true);
  assert.equal(r.patches.length,0);
});

test('Plano oculto: recusa escolha',async()=>{
  const r=await scenario({visible:false});
  assert.equal(r.status,409);
  assert.equal(r.body.error,'plan_not_available');
  assert.equal(r.patches.length,0);
});

test('Usuário não administrador: recusa troca',async()=>{
  const r=await scenario({role:'staff'});
  assert.equal(r.status,403);
  assert.equal(r.patches.length,0);
});

test('Cartão recorrente vinculado: exige cancelamento antes da escolha',async()=>{
  const r=await scenario({linked:true});
  assert.equal(r.status,409);
  assert.equal(r.body.error,'cancel_recurring_first');
  assert.equal(r.patches.length,0);
});
