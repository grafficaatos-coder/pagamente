type ChargeEmailInput = {
  to:string|string[];
  clientName?:string|null;
  organizationName?:string|null;
  description:string;
  amountCents:number;
  dueDate:string;
  paymentMethod?:string|null;
  paymentUrl?:string|null;
  digitableLine?:string|null;
  boletoUrl?:string|null;
  boletoLine?:string|null;
  pixUrl?:string|null;
  pixCode?:string|null;
};

function required(name:string){
  const value=process.env[name];
  if(!value) throw new Error(name+' não configurado no servidor.');
  return value;
}

function escapeHtml(value:string){
  return value
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

function brl(cents:number){
  return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cents||0)/100);
}

function dateBR(value:string){
  const date=new Date(value+'T00:00:00');
  return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat('pt-BR').format(date);
}

export async function sendChargeEmail(input:ChargeEmailInput){
  const apiKey=process.env.RESEND_API_KEY||process.env.EMAIL_API_KEY;
  if(!apiKey) throw new Error('RESEND_API_KEY (ou EMAIL_API_KEY) não configurado no servidor.');
  const from='JP Sistema de Cobrança <cobranca@jpsistemadecobranca.com.br>';
  const recipients=(Array.isArray(input.to)?input.to:[input.to]).map(item=>String(item||'').trim()).filter(Boolean);
  const uniqueRecipients=[...new Set(recipients.map(item=>item.toLowerCase()))];
  if(!uniqueRecipients.length) throw new Error('Nenhum e-mail válido informado para envio.');
  const method=input.paymentMethod==='pix'?'Pix':input.paymentMethod==='boleto_pix'?'boleto ou Pix':input.paymentMethod==='card'?'cartão de crédito':'boleto';
  const clientName=(input.clientName||'cliente').trim();
  const company=(input.organizationName||'JP Sistema de Cobrança').trim();
  const subject='Cobrança '+method+' - '+input.description;

  const textLines=[
    'Olá '+clientName+',',
    '',
    'Segue sua cobrança '+method+' referente a '+input.description+'.',
    'Valor: '+brl(input.amountCents),
    'Vencimento: '+dateBR(input.dueDate)
  ];
  if(input.paymentMethod==='boleto_pix'){
    if(input.boletoUrl) textLines.push('Boleto: '+input.boletoUrl);
    if(input.boletoLine) textLines.push('Linha digitável do boleto: '+input.boletoLine);
    if(input.pixUrl) textLines.push('Pix: '+input.pixUrl);
    if(input.pixCode) textLines.push('Pix Copia e Cola: '+input.pixCode);
  }else{
    if(input.paymentUrl) textLines.push('Link para pagamento: '+input.paymentUrl);
    if(input.digitableLine){
      textLines.push((input.paymentMethod==='pix'?'Pix Copia e Cola: ':'Linha digitável: ')+input.digitableLine);
    }
  }
  textLines.push('','Atenciosamente,',company);

  const safeClient=escapeHtml(clientName);
  const safeDescription=escapeHtml(input.description);
  const safeCompany=escapeHtml(company);
  const safePaymentUrl=input.paymentUrl?escapeHtml(input.paymentUrl):'';
  const safeLine=input.digitableLine?escapeHtml(input.digitableLine):'';
  const safeBoletoUrl=input.boletoUrl?escapeHtml(input.boletoUrl):'';
  const safeBoletoLine=input.boletoLine?escapeHtml(input.boletoLine):'';
  const safePixUrl=input.pixUrl?escapeHtml(input.pixUrl):'';
  const safePixCode=input.pixCode?escapeHtml(input.pixCode):'';

  const paymentButton=input.paymentUrl
    ? '<p style="margin:24px 0"><a href="'+safePaymentUrl+'" style="background:#0f9f78;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;display:inline-block">Abrir pagamento</a></p>'
    : '';

  const lineBlock=input.digitableLine
    ? '<div style="margin-top:18px;padding:14px;background:#f6f8fa;border-radius:8px"><strong>'+(input.paymentMethod==='pix'?'Pix Copia e Cola':'Linha digitável')+'</strong><div style="margin-top:8px;word-break:break-all">'+safeLine+'</div></div>'
    : '';

  const choiceBlock=input.paymentMethod==='boleto_pix'
    ? '<div style="margin:24px 0;padding:18px;border:1px solid #e3e8ec;border-radius:10px">'+
      '<h3 style="margin:0 0 12px">Escolha como pagar</h3>'+
      (safeBoletoUrl?'<p style="margin:10px 0"><a href="'+safeBoletoUrl+'" style="background:#0f9f78;color:#fff;text-decoration:none;padding:11px 16px;border-radius:8px;font-weight:700;display:inline-block">Pagar por boleto</a></p>':'')+
      (safeBoletoLine?'<div style="margin:10px 0;padding:12px;background:#f6f8fa;border-radius:8px"><strong>Linha digitável do boleto</strong><div style="margin-top:6px;word-break:break-all">'+safeBoletoLine+'</div></div>':'')+
      (safePixUrl?'<p style="margin:14px 0 10px"><a href="'+safePixUrl+'" style="background:#0f9f78;color:#fff;text-decoration:none;padding:11px 16px;border-radius:8px;font-weight:700;display:inline-block">Pagar por Pix</a></p>':'')+
      (safePixCode?'<div style="margin:10px 0;padding:12px;background:#f6f8fa;border-radius:8px"><strong>Pix Copia e Cola</strong><div style="margin-top:6px;word-break:break-all">'+safePixCode+'</div></div>':'')+
      '</div>'
    : '';

  const html='<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f5f7f8;margin:0;padding:24px;color:#16202a">'+
    '<div style="max-width:620px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">'+
    '<h2 style="margin-top:0">JP Sistema de Cobrança</h2>'+
    '<p>Olá '+safeClient+',</p>'+
    '<p>Segue sua cobrança <strong>'+method+'</strong> referente a <strong>'+safeDescription+'</strong>.</p>'+
    '<p><strong>Valor:</strong> '+escapeHtml(brl(input.amountCents))+'<br><strong>Vencimento:</strong> '+escapeHtml(dateBR(input.dueDate))+'</p>'+
    (input.paymentMethod==='boleto_pix'?choiceBlock:(paymentButton+lineBlock))+
    '<p style="margin-top:28px">Atenciosamente,<br><strong>'+safeCompany+'</strong></p>'+
    '</div></body></html>';

  const response=await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{
      authorization:'Bearer '+apiKey,
      'content-type':'application/json'
    },
    body:JSON.stringify({
      from,
      to:uniqueRecipients,
      subject,
      text:textLines.join('\n'),
      html
    })
  });

  const data:any=await response.json().catch(()=>({}));
  if(!response.ok){
    throw new Error(data?.message||data?.error||'Não foi possível enviar o e-mail.');
  }

  return {id:String(data?.id||'')};
}
