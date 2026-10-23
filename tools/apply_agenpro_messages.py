"""Desloca editores de WhatsApp para aba Mensagens sem mexer no conteúdo salvo."""
from pathlib import Path
import json

base=Path("agenda-nails")
index=base/"index.html"
html=index.read_text(encoding="utf-8")
if "function messages(){" in html and 'messages-layout.css' in html:
    print("A aba Mensagens já está instalada.")
    raise SystemExit(0)

def once(old,new):
    global html
    matches=html.count(old)
    if matches!=1:
        raise RuntimeError(f"Estrutura inesperada ({matches}): {old[:100]}")
    html=html.replace(old,new,1)

wa_marker="    function wa(){"
wa_start=html.index(wa_marker)
start=html.index("  const customAppointmentText=",wa_start)
end=html.index("  const preferredPhoneRaw=",start)
templates=html[start:end]
for name in ("appointmentCard","reminderCard","changeCards","thankYouCard"):
    if f"const {name}=" not in templates:
        raise RuntimeError("Modelo não encontrado: "+name)
html=html[:start]+html[end:]

confirmation_card = """  const confirmationCard=`<section class="panel message-settings-confirmation">
    <div class="head"><div><span class="eyebrow">Confirmação de horário</span><h3>Mensagem de confirmação</h3></div>
      <span class="status-badge status-active">Modelo compartilhado</span></div>
    <p>A confirmação usa o mesmo texto de <b>Mensagem de agendamento</b>. O lembrete pode incluir separadamente o link para o cliente confirmar.</p>
    <div class="message-linked-info">Para mudar este texto, edite a mensagem de agendamento. O envio continua utilizando o modelo salvo para esta empresa.</div>
    ${admin?'<button type="button" class="btn secondary" style="margin-top:12px" onclick="openAppointmentMessageEditor()">✏️ Editar texto de confirmação/agendamento</button>':''}
    <details style="margin-top:12px"><summary>Ver prévia da confirmação</summary>
      <p style="white-space:pre-wrap;line-height:1.6">${appModalEscape(formatAppointmentTemplate(appointmentPreviewText,{cliente:'Cliente',empresa:whatsappBookingName(companyCtx?.business?.name||'Agenda Pro'),data:'15/10/2026',horario:'10:00',servico:'Atendimento',profissional:'Profissional'})||'')}</p>
    </details>
  </section>`;
"""
page_fn = """    function messages(){
  const admin=canAdminCompany();
""" + templates + confirmation_card + """  return shell(`<div class="section-title"><span class="eyebrow">Personalização da empresa</span>
    <h2>Mensagens</h2><p>Personalize os textos de agendamentos, lembretes e alterações enviados pelo WhatsApp.</p></div>
    <section class="message-settings-intro">
      <div><strong>Seus modelos ficam salvos por empresa</strong><p>O envio automático e os horários dos lembretes continuam funcionando como antes. Somente administradores podem editar.</p></div>
      <button type="button" class="btn secondary" onclick="go('wa')">Ver conexão do WhatsApp</button>
    </section>
    <div class="message-settings-grid">
      ${appointmentCard}
      ${reminderCard}
      ${changeCards}
      ${confirmationCard}
      ${thankYouCard}
    </div>`);
}
"""
once(wa_marker,page_fn+wa_marker)
D="$"+"{"
once("  "+D+"appointmentCard}\n  "+D+"reminderCard}\n  "+D+"changeCards}\n  "+D+"thankYouCard}\n  "+D+"baileysCard",
     "  "+D+"baileysCard")
once("    wa:['WhatsApp','Lembretes e confirmações'],",
     "    wa:['WhatsApp','Conexão e envio automático'],\n    messages:['Mensagens','Modelos e textos automáticos'],")
once("n.push(['wa','message','WhatsApp'],['support','message','Suporte']);",
     "n.push(['wa','message','WhatsApp'],['messages','message','Mensagens'],['support','message','Suporte']);")
once("cash:hasFeature('finance'),wa:true,support:true,team:canAdminCompany()",
     "cash:hasFeature('finance'),wa:true,messages:true,support:true,team:canAdminCompany()")
once("({home,agenda,clients,services,cash,wa,team,profile:myProfile",
     "({home,agenda,clients,services,cash,wa,messages,team,profile:myProfile")
once('<link rel="stylesheet" href="/mobile-redesign.css?v=20261023-5">',
     '<link rel="stylesheet" href="/mobile-redesign.css?v=20261023-5">\n  <link rel="stylesheet" href="/messages-layout.css?v=20261023-6">')
once("const AGENDA_UI_VERSION='2026.10.23.4';",
     "const AGENDA_UI_VERSION='2026.10.23.6';")
wa_section=html[html.index(wa_marker):html.index("    function setup(){",html.index(wa_marker))]
for name in ("appointmentCard","reminderCard","changeCards","thankYouCard"):
    if D+name+"}" in wa_section:
        raise RuntimeError("Modelo de edição permaneceu na aba WhatsApp: "+name)
index.write_text(html,encoding="utf-8")

manifest=base/"app-version.json"
version=json.loads(manifest.read_text(encoding="utf-8"))
version.update(version="2026.10.23.6",released_at="2026-10-23",name="AgenPro",
   notes="Nova aba Mensagens com modelos editáveis; WhatsApp somente conexão e envio.")
manifest.write_text(json.dumps(version,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

sw_path=base/"sw.js"
sw=sw_path.read_text(encoding="utf-8")
old_cache="agenpro-shell-v51-mobile-redesign-20261023"
if old_cache not in sw:
    raise RuntimeError("Versão de cache inesperada")
sw_path.write_text(sw.replace(old_cache,"agenpro-shell-v52-mensagens-20261023"),encoding="utf-8")
assert (base/"messages-layout.css").is_file(), "CSS da aba Mensagens ausente"
print("Aba Mensagens instalada. Modelos e regras de envio preservados.")
