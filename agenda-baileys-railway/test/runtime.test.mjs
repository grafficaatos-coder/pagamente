import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { persistentAuthState } from '../auth-state.mjs';
process.env.SUPABASE_URL='http://127.0.0.1:1';
process.env.ALLOWED_BUSINESS_IDS='11111111-1111-4111-8111-111111111111';
const { WhatsSession } = await import('../server.mjs');

test('credentials and signal keys survive restart, remain isolated, and delete correctly',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'agenda-auth-'));
  try{
    const a=await persistentAuthState(path.join(root,'a'));
    a.state.creds.registered=true;
    await Promise.all([a.saveCreds(),a.state.keys.set({session:{alice:Buffer.from([1,2,3])}})]);
    const restored=await persistentAuthState(path.join(root,'a'));
    assert.equal(restored.state.creds.registered,true);
    assert.deepEqual((await restored.state.keys.get('session',['alice'])).alice,Buffer.from([1,2,3]));
    const b=await persistentAuthState(path.join(root,'b'));
    assert.deepEqual(await b.state.keys.get('session',['alice']),{});
    await restored.state.keys.set({session:{alice:null}});
    const again=await persistentAuthState(path.join(root,'a'));
    assert.deepEqual(await again.state.keys.get('session',['alice']),{});
    await writeFile(path.join(root,'a','auth.json'),'invalid');
    await assert.rejects(persistentAuthState(path.join(root,'a')));
  }finally{await rm(root,{recursive:true,force:true})}
});
test('a denied lease or database outage immediately closes the socket',async()=>{
  const original=globalThis.fetch;
  try{
    for(const failure of [false,true]){
      globalThis.fetch=async()=>{if(failure)throw new Error('offline');return new Response('false')};
      const s=new WhatsSession('11111111-1111-4111-8111-111111111111');
      let closed=false;s.sock={end(){closed=true}};s.leaseOwned=true;s.leaseExpires=performance.now()+10000;
      await s.leaseCycle().catch(()=>{});
      assert.equal(closed,true);assert.equal(s.hasLease(),false);assert.equal(s.sock,null);
    }
  }finally{globalThis.fetch=original}
});
test('queue cannot dispatch with migration pause or expired lease',async()=>{
  const s=new WhatsSession('11111111-1111-4111-8111-111111111111');
  s.state='online';s.leaseOwned=true;s.leaseExpires=performance.now()-1;
  s.sock={sendMessage(){assert.fail('must not send')}};
  assert.equal(s.hasLease(),false);await s.dispatchCycle();assert.equal(s.dispatchBusy,false);
});

test('pairing code is not exposed after the QR challenge changes or code expires',()=>{
  const s=new WhatsSession('11111111-1111-4111-8111-111111111111');
  s.state='waiting_qr';s.qrReady=true;s.pairCode='ABCD1234';s.pairExpires=Date.now()+60000;
  assert.equal(s.status().pairing_code,'ABCD1234');
  s.qrReady=false;
  assert.equal(s.status().pairing_code,null);
  s.qrReady=true;s.pairExpires=Date.now()-1000;
  assert.equal(s.status().pairing_code,null);
});
test('force_new requests a fresh code instead of reusing a cached one',async()=>{
  const original=globalThis.fetch;
  let requests=0;
  try{
    globalThis.fetch=async()=>new Response('',{status:201});
    const s=new WhatsSession('11111111-1111-4111-8111-111111111111');
    s.hasLease=()=>true;
    s.state='waiting_qr';
    s.qrReady=true;
    s.sock={requestPairingCode:async()=>{requests++;return requests===1?'ABCD1234':'WXYZ5678'}};
    const first=await s.pairingCode('41999999999');
    assert.equal(first,'ABCD1234');
    const reused=await s.pairingCode('41999999999');
    assert.equal(reused,'ABCD1234');
    assert.equal(requests,1);
    const refreshed=await s.pairingCode('41999999999',{forceNew:true});
    assert.equal(refreshed,'WXYZ5678');
    assert.equal(requests,2);
    assert.equal(s.status().pairing_code,'WXYZ5678');
  }finally{globalThis.fetch=original}
});

test('agradecimento personalizado substitui apenas variáveis da empresa e da cliente',async()=>{
  const {personalizeThankYouMessage}=await import('../server.mjs');
  assert.equal(
    personalizeThankYouMessage('Olá, {{cliente}}! Obrigada por visitar {{empresa}}. {{CLIENTE}}','Juliana','Julli'),
    'Olá, Juliana! Obrigada por visitar Julli. Juliana'
  );
  assert.equal(personalizeThankYouMessage(null,'Juliana','Julli'),null);
  assert.equal(personalizeThankYouMessage('   ','Juliana','Julli'),null);
  assert.equal(personalizeThankYouMessage('X'.repeat(1601),'Juliana','Julli'),null);
  assert.equal(personalizeThankYouMessage('{{telefone}} {{cliente}}','Ana','Julli'),'{{telefone}} Ana');
});

test('confirmação editável altera somente o corpo e mantém variáveis automáticas',async()=>{
  const {personalizeAppointmentConfirmation}=await import('../server.mjs');
  const details={cliente:'Juliana',empresa:'Julli',data:'15/10/2026',horario:'10:00',servico:'Coloração',profissional:'Jesiel'};
  assert.equal(personalizeAppointmentConfirmation('Olá {{cliente}}, confirme seu horário na {{empresa}} em {{data}} às {{horario}} para {{servico}} com {{profissional}}.',details),
    'Olá Juliana, confirme seu horário na Julli em 15/10/2026 às 10:00 para Coloração com Jesiel.');
  assert.equal(personalizeAppointmentConfirmation('Olá {{CLIENTE}}!\n👤 Profissional: {{profissional}}\nAté logo', {...details,profissional:''}),
    'Olá Juliana!\nAté logo');
  assert.equal(personalizeAppointmentConfirmation('{{telefone}} {{cliente}}',details),'{{telefone}} Juliana');
  assert.equal(personalizeAppointmentConfirmation(null,details),null);
  assert.equal(personalizeAppointmentConfirmation('   ',details),null);
  assert.equal(personalizeAppointmentConfirmation('x'.repeat(1601),details),null);
});

test('lembrete de Juliana Garcia usa com a e preserva outras empresas',async()=>{
  const {reminderBusinessPhrase}=await import('../server.mjs');
  assert.equal(reminderBusinessPhrase('By Juliana Garcia'),'com a *Juliana Garcia*');
  assert.equal(reminderBusinessPhrase('Juliana Garcia'),'com a *Juliana Garcia*');
  assert.equal(reminderBusinessPhrase('Julli'),'na *Julli*');
  assert.equal(reminderBusinessPhrase('Metanoia Terapia de Resultados'),'na *Metanoia Terapia de Resultados*');
});
