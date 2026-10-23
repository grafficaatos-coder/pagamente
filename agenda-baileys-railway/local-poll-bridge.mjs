// Supabase outbound-only bridge. No public tunnel, listener or front-end secret.
// Commands are written by a JWT-authenticated Edge Function, claimed using a
// service-role-only RPC and never automatically retried after being claimed.
export function startLocalPollBridge({
  db, rpc, sessions, ensureSession, allowedBusinesses, logger, isShuttingDown
}){
  const ids=[...allowedBusinesses];
  let busy=false;
  let closed=false;
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  async function publishStatus(businessId){
    const s=sessions.get(businessId);
    const snapshot=s&&!s.stopped?{ok:true,...s.status()}:
      {ok:true,status:"disconnected",phone:null,qr_svg:null,pairing_code:null,last_error:null};
    const r=await db("/rest/v1/agenda_whatsapp_local_status?on_conflict=business_id",{
      method:"POST",
      headers:{Prefer:"resolution=merge-duplicates,return=minimal"},
      body:JSON.stringify({business_id:businessId,snapshot,updated_at:new Date().toISOString()})
    });
    if(!r.ok)throw new Error("Local status: "+r.status+" "+(await r.text()).slice(0,200));
  }

  async function execute(job){
    const id=job.business_id;
    if(!allowedBusinesses.has(id))throw Object.assign(new Error("Empresa não autorizada no Docker"),{status:403});
    if(job.action==="connect"){
      const s=await ensureSession(id);
      const start=Date.now();
      while(Date.now()-start<12000&&!["online","waiting_qr","error"].includes(s.state))await wait(250);
      return {status:200,body:{ok:true,...s.status()}};
    }
    if(job.action==="pair-code"){
      const s=await ensureSession(id);
      const code=await s.pairingCode(job.payload?.phone||"",{forceNew:job.payload?.force_new===true});
      return {status:200,body:{ok:true,status:"qr",pairing_code:code}};
    }
    if(job.action==="disconnect"){
      const s=sessions.get(id);
      if(s)await s.disconnect();
      // Never touch a Railway tenant: id has already passed the explicit allow-list.
      else throw Object.assign(new Error("Sessão local não encontrada"),{status:409});
      sessions.delete(id);
      return {status:200,body:{ok:true,status:"disconnected"}};
    }
    throw Object.assign(new Error("Comando inválido"),{status:400});
  }

  async function cycle(){
    if(busy||closed||isShuttingDown())return;
    busy=true;
    try{
      for(const id of ids){
        if(closed||isShuttingDown())break;
        // Publish fresh status even if no command is waiting.
        await publishStatus(id);
        const job=await rpc("agenda_local_claim_next",{p_business_id:id});
        // Supabase/PostgREST can encode a null composite row as an object with
        // null fields. Treat it as an empty queue; never execute or finish it.
        if(!job || !job.id)continue;
        // Do not execute an unexpected or partially populated command.
        if(job.business_id!==id || !job.action || !job.claim_token){
          logger.warn({business:id},"Local bridge rejected malformed claimed command");
          continue;
        }
        let status=200, body;
        try{
          const done=await execute(job);
          status=done.status;body=done.body;
        }catch(e){
          status=Number(e?.status)||500;
          body={error:String(e?.message||e).slice(0,350)};
          logger.warn({business:id,action:job.action,status}, "Local command failed");
        }
        await rpc("agenda_local_finish",{
          p_id:job.id,
          p_claim_token:job.claim_token,
          p_status:status>=400?"failed":"completed",
          p_result:body,
          p_http_status:status
        });
        await publishStatus(id);
      }
    }catch(e){
      logger.warn({error:String(e?.message||e).slice(0,400)}, "Supabase local bridge unavailable; retrying");
    }finally{busy=false}
  }
  const timer=setInterval(()=>void cycle(),2500);
  timer.unref?.();
  void cycle();
  return ()=>{closed=true;clearInterval(timer)};
}
