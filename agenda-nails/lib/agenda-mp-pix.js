// Agenda Pro PIX — reconciliacao independente e idempotente de pagamentos.
// NUNCA confie em status enviado pelo navegador ou no corpo do webhook.
const PAYMENT_ID=/^\d{1,40}$/;
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const cents=n=>Math.round(Number(n)*100);

export async function reconcilePixPayment(paymentId) {
  const id=String(paymentId||'');
  if(!PAYMENT_ID.test(id))return {ok:false,error:'invalid_payment_id',http:400};
  const root=process.env.AGENDA_SUPABASE_URL;
  const key=process.env.AGENDA_SUPABASE_SECRET_KEY;
  const mpKey=process.env.AGENDA_MP_ACCESS_TOKEN;
  if(!root||!key||!mpKey)return {ok:false,error:'billing_not_configured',http:503};
  let base;
  try{base=new URL(root);if(base.protocol!=='https:')throw Error('url')}catch(_){
    return {ok:false,error:'invalid_configuration',http:503};
  }
  const h={apikey:key,Authorization:'Bearer '+key,Accept:'application/json'};
  try {
    const url=new URL('/rest/v1/agenda_mp_pix_charges',base);
    url.searchParams.set('select','id,business_id,plan_id,amount_cents,external_reference,mp_payment_id,status,expires_at');
    url.searchParams.set('mp_payment_id','eq.'+id);
    url.searchParams.set('limit','2');
    const listed=await fetch(url,{headers:h,signal:AbortSignal.timeout(9000)});
    if(!listed.ok)return {ok:false,error:'database_unavailable',http:502};
    const rows=await listed.json();
    if(rows.length===0)return {ok:true,linked:false,processed:false};
    if(rows.length!==1)return {ok:false,error:'duplicate_payment_id',http:502};
    const charge=rows[0];
    if(!UUID.test(String(charge.id||'')))return {ok:false,error:'invalid_charge',http:502};
    // Always re-fetch the payment directly from Mercado Pago.
    const checked=await fetch('https://api.mercadopago.com/v1/payments/'+encodeURIComponent(id),{
      headers:{Authorization:'Bearer '+mpKey,Accept:'application/json'},
      signal:AbortSignal.timeout(10000)
    });
    if(!checked.ok)return {ok:false,error:'provider_unavailable',http:502};
    const payment=await checked.json();
    if(String(payment.id||'')!==id ||
      String(payment.external_reference||'')!==charge.external_reference ||
      payment.payment_method_id!=='pix' ||
      payment.currency_id!=='BRL' ||
      cents(payment.transaction_amount)!==Number(charge.amount_cents) ||
      !Number.isSafeInteger(cents(payment.transaction_amount))){
      return {ok:false,error:'provider_payment_mismatch',http:502};
    }
    if(payment.status!=='approved'||payment.status_detail!=='accredited'){
      return {ok:true,linked:true,processed:false,status:'pending'};
    }
    const paidAt=String(payment.date_approved||'');
    if(!Number.isFinite(Date.parse(paidAt)))return {ok:false,error:'invalid_paid_at',http:502};
    const rpc=new URL('/rest/v1/rpc/agenda_mp_apply_verified_pix',base);
    const applied=await fetch(rpc,{
      method:'POST',
      headers:{...h,'Content-Type':'application/json'},
      body:JSON.stringify({
        p_charge_id:charge.id,p_payment_id:id,p_amount_cents:charge.amount_cents,
        p_currency:'BRL',p_provider_status:'approved',p_paid_at:paidAt
      }),
      signal:AbortSignal.timeout(11000)
    });
    if(!applied.ok)return {ok:false,error:'payment_application_failed',http:502};
    const result=await applied.json();
    return {ok:true,linked:true,processed:Boolean(result?.applied),
      duplicate:result?.reason==='duplicate',status:'approved'};
  }catch(_){return {ok:false,error:'pix_verification_unavailable',http:502}}
}
