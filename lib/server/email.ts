type ChargeEmailInput = {
  to:string;
  clientName?:string|null;
  organizationName?:string|null;
  description:string;
  amountCents:number;
  dueDate:string;
  paymentMethod?:string|null;
  paymentUrl?:string|null;
  digitableLine?:string|null;
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
  const from=required('EMAIL_FROM');
  const method=input.paymentMethod==='pix'?'Pix':'boleto';
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
  if(input.paymentUrl) textLines.push('Link para pagamento: '+input.paymentUrl);
  if(input.digitableLine){
    textLines.push((input.paymentMethod==='pix'?'Pix Copia e Cola: ':'Linha digitável: ')+input.digitableLine);
  }
  textLines.push('','Atenciosamente,',company);

  const safeClient=escapeHtml(clientName);
  const safeDescription=escapeHtml(input.description);
  const safeCompany=escapeHtml(company);
  const safePaymentUrl=input.paymentUrl?escapeHtml(input.paymentUrl):'';
  const safeLine=input.digitableLine?escapeHtml(input.digitableLine):'';

  const paymentButton=input.paymentUrl
    ? '<p style="margin:24px 0"><a href="'+safePaymentUrl+'" style="background:#0f9f78;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;display:inline-block">Abrir pagamento</a></p>'
    : '';

  const lineBlock=input.digitableLine
    ? '<div style="margin-top:18px;padding:14px;background:#f6f8fa;border-radius:8px"><strong>'+(input.paymentMethod==='pix'?'Pix Copia e Cola':'Linha digitável')+'</strong><div style="margin-top:8px;word-break:break-all">'+safeLine+'</div></div>'
    : '';

  const html='<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f5f7f8;margin:0;padding:24px;color:#16202a">'+
    '<div style="max-width:620px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">'+
    '<h2 style="margin-top:0">JP Sistema de Cobrança</h2>'+
    '<p>Olá '+safeClient+',</p>'+
    '<p>Segue sua cobrança <strong>'+method+'</strong> referente a <strong>'+safeDescription+'</strong>.</p>'+
    '<p><strong>Valor:</strong> '+escapeHtml(brl(input.amountCents))+'<br><strong>Vencimento:</strong> '+escapeHtml(dateBR(input.dueDate))+'</p>'+
    paymentButton+lineBlock+
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
      to:[input.to],
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
