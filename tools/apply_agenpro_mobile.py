"""Aplicar melhorias mobile ao AgenPro a partir da raiz do repositório."""
from pathlib import Path
import json

base = Path('agenda-nails')
index = base / 'index.html'
html = index.read_text(encoding='utf-8')


def change(old, new, count=1):
    global html
    found = html.count(old)
    if found != count:
        raise RuntimeError(f'Trecho do sistema mudou; esperado {count}, encontrado {found}: {old[:60]}')
    html = html.replace(old, new, count)

change('</style>\n</head>', '</style>\n  <link rel="stylesheet" href="/mobile-redesign.css?v=20261023-5">\n</head>')
change('<span class="premium-brand-title">Agenda Pro</span></div>', '''<span class="premium-brand-title">AgenPro</span></div><button class="mobile-side-close" type="button" onclick="closeMobileMenu()" aria-label="Fechar menu">×</button><button class="mobile-side-account" type="button" onclick="go('profile')" aria-label="Meu perfil"><span class="mobile-side-avatar">${appModalEscape(dashboardInitials(account))}</span><span class="mobile-side-person"><strong>${account}</strong><small>${status}</small></span></button>''')
start = html.index('    function bottom(){')
end = html.index("  const n=[['overview','home','Início']", start)
html = html[:start] + '''    function bottom(){
  if(appMode==='company'){
    const homeLink=['home','home','Início'];
    const agendaLink=hasFeature('agenda')?['agenda','calendar','Agenda']:hasFeature('finance')?['cash','wallet','Financeiro']:['wa','message','WhatsApp'];
    const peopleLink=hasFeature('clients')?['clients','users',P().people]:['wa','message','WhatsApp'];
    const item=x=>`<button type="button" class="${page===x[0]?'on':''}" onclick="go('${x[0]}')" aria-label="${appModalEscape(x[2])}">${I[x[1]]}<span>${appModalEscape(x[2])}</span></button>`;
    const create=hasFeature('agenda')&&canOperateCompany()?`<button class="mobile-nav-create" type="button" onclick="book()" aria-label="Novo agendamento"><span class="nav-plus">${I.plus}</span><span>Novo</span></button>`:`<button class="mobile-nav-create" type="button" onclick="go('wa')" aria-label="WhatsApp"><span class="nav-plus">${I.message}</span><span>WhatsApp</span></button>`;
    return `<nav class="bottom company-bottom" aria-label="Navegação principal">${item(homeLink)}${item(agendaLink)}${create}${item(peopleLink)}<button type="button" onclick="toggleMobileMenu()" aria-label="Abrir mais opções" aria-expanded="false">${I.more}<span>Mais</span></button></nav>`;
  }
''' + html[end:]
change('<div class="logo mini-logo">${p.initials}</div><div><h1>', '<div class="logo mini-logo">${p.initials}</div><span class="mobile-brand-name">AgenPro</span><div><h1>')
change('return shell(`<div class="agenda-dashboard premium-dashboard">\n    <div class="dashboard-kpis">${metrics}</div>', '''return shell(`<div class="agenda-dashboard premium-dashboard">
    <section class="mobile-welcome" aria-label="Resumo do dia"><div class="mobile-welcome-main"><span class="welcome-eyebrow">Bem-vindo de volta</span><h2>Olá, ${appModalEscape(displayBusinessName(companyCtx?.business?.name||'AgenPro'))}!</h2><p>Confira seus agendamentos de hoje.</p></div><span class="mobile-welcome-date">${I.calendar} Hoje</span></section>
    <div class="dashboard-kpis">${metrics}</div>''')
change('<button class="mobile-menu-toggle" onclick="toggleMobileMenu()" aria-label="Abrir menu"><svg','<button class="mobile-menu-toggle" onclick="toggleMobileMenu()" aria-label="Abrir menu" aria-expanded="false"><svg',2)
change("  side.classList.toggle('mobile-open',opening);\n  overlay?.classList.toggle('open',opening);", "  side.classList.toggle('mobile-open',opening);\n  document.querySelectorAll('.mobile-menu-toggle,.company-bottom button[aria-label=\"Abrir mais opções\"]').forEach(btn=>btn.setAttribute('aria-expanded',String(opening)));\n  overlay?.classList.toggle('open',opening);")
change("  document.querySelector('.side')?.classList.remove('mobile-open');\n  document.querySelector('.mobile-menu-overlay')?.classList.remove('open');", "  document.querySelector('.side')?.classList.remove('mobile-open');\n  document.querySelectorAll('.mobile-menu-toggle,.company-bottom button[aria-label=\"Abrir mais opções\"]').forEach(btn=>btn.setAttribute('aria-expanded','false'));\n  document.querySelector('.mobile-menu-overlay')?.classList.remove('open');")
change('    function isStandaloneApp(){', "    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('mobile-menu-active'))closeMobileMenu()});\n    function isStandaloneApp(){")
index.write_text(html, encoding='utf-8')
assert (base / 'mobile-redesign.css').is_file(), 'CSS do layout móvel não encontrado'
version_file = base / 'app-version.json'
version = json.loads(version_file.read_text(encoding='utf-8'))
version.update(version='2026.10.23.5', released_at='2026-10-23', name='AgenPro', notes='Novo layout profissional para celular.')
version_file.write_text(json.dumps(version, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
sw_file = base / 'sw.js'
sw = sw_file.read_text(encoding='utf-8')
if 'agenda-pro-shell-v50-dashboard-premium-reference-20261023' in sw:
    sw_file.write_text(sw.replace('agenda-pro-shell-v50-dashboard-premium-reference-20261023','agenpro-shell-v51-mobile-redesign-20261023'),encoding='utf-8')
print('Layout móvel aplicado aos arquivos do projeto.')
