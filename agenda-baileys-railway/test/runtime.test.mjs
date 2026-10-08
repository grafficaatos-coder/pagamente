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
