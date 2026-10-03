type ChargeWhatsAppInput = {
  to:string;
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

function brl(cents:number){
  return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cents||0)/100);
}

function dateBR(value:string){
  const date=new Date(value+'T00:00:00');
  return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat('pt-BR').format(date);
}

export function buildChargeWhatsAppText(input:ChargeWhatsAppInput){
  const method=input.paymentMethod==='pix'
    ?'Pix'
    :input.paymentMethod==='boleto_pix'
      ?'boleto ou Pix'
      :input.paymentMethod==='card'
        ?'cartão de crédito'
        :'boleto';

  const lines=[
    'Olá '+(input.clientName||'cliente')+',',
    '',
    'Segue sua cobrança '+method+' referente a '+input.description+'.',
    'Valor: '+brl(input.amountCents),
    'Vencimento: '+dateBR(input.dueDate)
  ];

  if(input.paymentMethod==='boleto_pix'){
    if(input.boletoUrl) lines.push('Boleto: '+input.boletoUrl);
    if(input.boletoLine) lines.push('Linha digitável: '+input.boletoLine);
    if(input.pixUrl) lines.push('Pix: '+input.pixUrl);
    if(input.pixCode) lines.push('Pix Copia e Cola: '+input.pixCode);
  }else{
    if(input.paymentUrl) lines.push('Link para pagamento: '+input.paymentUrl);
    if(input.digitableLine){
      lines.push((input.paymentMethod==='pix'?'Pix Copia e Cola: ':'Linha digitável: ')+input.digitableLine);
    }
  }

  lines.push('','Atenciosamente,',input.organizationName||'JP Sistema de Cobrança');
  return lines.join('\n');
}

export async function sendChargeWhatsApp(input:ChargeWhatsAppInput){
  const token=process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId=process.env.WHATSAPP_PHONE_NUMBER_ID;
  if(!token||!phoneNumberId){
    throw new Error('WhatsApp automático ainda não está conectado. Configure WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID.');
  }

  let phone=String(input.to||'').replace(/\D/g,'');
  if(phone.length>=10&&phone.length<=11) phone='55'+phone;
  if(phone.length<12) throw new Error('Número de WhatsApp inválido.');

  const version=process.env.WHATSAPP_API_VERSION||'v23.0';
  const text=buildChargeWhatsAppText(input);
  const response=await fetch('https://graph.facebook.com/'+version+'/'+encodeURIComponent(phoneNumberId)+'/messages',{
    method:'POST',
    headers:{
      authorization:'Bearer '+token,
      'content-type':'application/json'
    },
    body:JSON.stringify({
      messaging_product:'whatsapp',
      recipient_type:'individual',
      to:phone,
      type:'text',
      text:{preview_url:true,body:text}
    })
  });
  const data:any=await response.json().catch(()=>({}));
  if(!response.ok){
    const message=data?.error?.message||'Não foi possível enviar a mensagem pelo WhatsApp.';
    throw new Error(message);
  }
  return {id:String(data?.messages?.[0]?.id||'')};
}
