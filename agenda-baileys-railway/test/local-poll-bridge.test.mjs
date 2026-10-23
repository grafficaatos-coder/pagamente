import test from "node:test";
import assert from "node:assert/strict";
import { startLocalPollBridge } from "../local-poll-bridge.mjs";

const TEST_ID="00000000-0000-4000-8000-000000000001";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test("outbound local bridge uses private RPC and publishes status without sending a WhatsApp message",async()=>{
  let claimed=false;
  let finished=null;
  const published=[];
  const session={state:"online",stopped:false,status:()=>({status:"connected",phone:"5500000000000"})};
  const sessions=new Map([[TEST_ID,session]]);
  const stop=startLocalPollBridge({
    db:async(url,options)=>{
      assert.ok(url.includes("agenda_whatsapp_local_status"));
      published.push(JSON.parse(options.body));
      return {ok:true};
    },
    rpc:async(name,params)=>{
      if(name==="agenda_local_claim_next"){
        assert.equal(params.p_business_id,TEST_ID);
        if(claimed)return null;
        claimed=true;
        return {id:"00000000-0000-4000-8000-000000000002",
          business_id:TEST_ID,action:"connect",claim_token:"00000000-0000-4000-8000-000000000003"};
      }
      if(name==="agenda_local_finish"){finished=params;return true;}
      throw Error("unexpected RPC "+name);
    },
    sessions,
    ensureSession:async()=>session,
    allowedBusinesses:new Set([TEST_ID]),
    logger:{warn:()=>{}},
    isShuttingDown:()=>false
  });
  try{
    await sleep(100);
    assert.ok(published.length>=1);
    assert.equal(published[0].business_id,TEST_ID);
    assert.equal(finished?.p_status,"completed");
    assert.equal(finished?.p_result?.status,"connected");
    assert.equal(finished?.p_http_status,200);
  }finally{stop();}
});

test("bridge rejects disconnect without a local session (no Railway tenant mutation)",async()=>{
  let claimed=false;
  let finished=null;
  const stop=startLocalPollBridge({
    db:async()=>({ok:true}),
    rpc:async(name,params)=>{
      if(name==="agenda_local_claim_next"){
        if(claimed)return null;
        claimed=true;
        return {id:"00000000-0000-4000-8000-000000000004",
          business_id:TEST_ID,action:"disconnect",claim_token:"00000000-0000-4000-8000-000000000005"};
      }
      if(name==="agenda_local_finish"){finished=params;return true;}
      throw Error("unexpected RPC "+name);
    },
    sessions:new Map(),
    ensureSession:async()=>{throw Error("should never connect")},
    allowedBusinesses:new Set([TEST_ID]),
    logger:{warn:()=>{}},
    isShuttingDown:()=>false
  });
  try{
    await sleep(100);
    assert.equal(finished?.p_status,"failed");
    assert.equal(finished?.p_http_status,409);
  }finally{stop();}
});
