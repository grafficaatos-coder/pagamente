function required(name:string){
  const value=process.env[name];
  if(!value) throw new Error(name+' não configurado no servidor.');
  return value;
}

function escapeHtml(value:string){
  return value.replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[char]||char));
}

function brlFromCents(cents:number){
  return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
}

function dateBR(value:string){
  const [y,m,d]=value.split('-');
  return y&&m&&d?d+'/'+m+'/'+y:value;
}

export type ChargeEmailInput={
  to:string;
  clientName:string;
  description:string;
  amountCents:number;
  dueDate:string;
  paymentMethod:'boleto'|'pix'|string|null|undefined;
  paymentUrl?:string|null;
  digitableLine?:string|null;
};

export async function sendChargeEmail(input:ChargeEmailInput){
  const apiKey=required('RESEND_API_KEY');
  const from=process.env.EMAIL_FROM||'JP Sistema de Cobrança <cobranca@jpsistemadecobranca.com.br>';
  const isPix=input.paymentMethod==='pix';
  const methodLabel=isPix?'Pix':'boleto';
  const copyLabel=isPix?'Pix Copia e Cola':'Linha digitável';

  const subject='Cobrança - '+input.description;
  const safeName=escapeHtml(input.clientName||'Cliente');
  const safeDescription=escapeHtml(input.description);
  const safeUrl=input.paymentUrl?escapeHtml(input.paymentUrl):'';
  const safeLine=input.digitableLine?escapeHtml(input.digitableLine):'';

  const html=`
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#14213d">
      <div style="padding:24px 0;border-bottom:1px solid #e8edf3">
        <h1 style="margin:0;font-size:24px">JP Sistema de Cobrança</h1>
      </div>
      <div style="padding:28px 0">
        <p>Olá, <strong>${safeName}</strong>.</p>
        <p>Segue sua cobrança por <strong>${methodLabel}</strong>.</p>
        <div style="background:#f6f8fb;border-radius:12px;padding:18px;margin:22px 0">
          <p style="margin:0 0 8px"><strong>Descrição:</strong> ${safeDescription}</p>
          <p style="margin:0 0 8px"><strong>Valor:</strong> ${brlFromCents(input.amountCents)}</p>
          <p style="margin:0"><strong>Vencimento:</strong> ${dateBR(input.dueDate)}</p>
        </div>
        ${safeUrl?`<p><a href="${safeUrl}" style="display:inline-block;background:#078a6c;color:#fff;text-decoration:none;padding:13px 20px;border-radius:8px;font-weight:700">Abrir ${methodLabel}</a></p>`:''}
        ${safeLine?`<p style="margin-top:22px"><strong>${copyLabel}:</strong></p><div style="word-break:break-all;background:#f6f8fb;border-radius:8px;padding:14px">${safeLine}</div>`:''}
        <p style="margin-top:28px;color:#667085;font-size:13px">Mensagem automática enviada pelo JP Sistema de Cobrança.</p>
      </div>
    </div>
  `;

  const response=await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{
      'content-type':'application/json',
      authorization:'Bearer '+apiKey
    },
    body:JSON.stringify({
      from,
      to:[input.to],
      subject,
      html
    })
  });

  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const message=typeof data?.message==='string'?data.message:'Falha ao enviar e-mail.';
    throw new Error(message);
  }
  return data;
}
