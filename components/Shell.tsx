'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell, Building2, ChartNoAxesCombined, ChevronRight, CircleDollarSign, CreditCard,
  FileClock, History, LayoutDashboard, LogOut, Menu, ReceiptText, RefreshCw, Settings,
  ShieldCheck, UsersRound, WalletCards, X
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useData } from '@/components/DataProvider';

const mainNav = [
  ['/', 'Início', LayoutDashboard],
  ['/clientes', 'Clientes', UsersRound],
  ['/cobrancas', 'Cobranças', ReceiptText],
  ['/transferir', 'Transferir', CircleDollarSign],
  ['/transacoes', 'Transações', History],
  ['/recorrencias', 'Recorrências', FileClock],
  ['/relatorios', 'Relatórios', ChartNoAxesCombined],
] as const;
const secondaryNav = [
  ['/integracoes', 'Integrações', ShieldCheck],
  ['/assinatura', 'Assinatura', CreditCard],
  ['/configuracoes', 'Configurações', Settings],
] as const;

export default function Shell({ children, title, subtitle, actions }: { children: React.ReactNode; title: string; subtitle?: string; actions?: React.ReactNode }) {
  const pathname = usePathname();
  const { mode, user, signOut } = useAuth();
  const { state, syncing, refresh } = useData();
  const [mobileOpen, setMobileOpen] = useState(false);
  const nav = (items: ReadonlyArray<readonly [string, string, any]>) => items.map(([href, label, Icon]) => {
    const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
    return <Link key={href} href={href} className={`nav-link ${active ? 'active' : ''}`} onClick={()=>setMobileOpen(false)}>
      <Icon size={19}/><span>{label}</span>{active && <ChevronRight className="nav-arrow" size={16}/>} 
    </Link>;
  });
  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><WalletCards size={23}/></div><span>pagamente</span><button className="sidebar-close" onClick={()=>setMobileOpen(false)}><X size={20}/></button></div>
      <div className="nav-caption">Menu</div>
      <nav>{nav(mainNav)}</nav>
      <div className="nav-caption secondary">Gestão</div>
      <nav>{nav(secondaryNav)}</nav>
      {state.isPlatformAdmin && <Link href="/plataforma" className={`nav-link platform ${pathname.startsWith('/plataforma') ? 'active' : ''}`}><Building2 size={19}/><span>Plataforma</span></Link>}
      <div className="sidebar-foot">
        <div className="account-mini"><div className="avatar">{(user?.email?.[0] ?? 'A').toUpperCase()}</div><div><strong>{state.organization?.name ?? 'Pagamente'}</strong><span>{user?.email ?? 'modo demonstração'}</span></div></div>
        {mode === 'supabase' && <button className="icon-btn dark" title="Sair" onClick={()=>signOut()}><LogOut size={18}/></button>}
      </div>
    </aside>
    {mobileOpen && <div className="sidebar-overlay" onClick={()=>setMobileOpen(false)}/>} 
    <main className="main-area">
      <header className="app-header">
        <button className="mobile-menu" onClick={()=>setMobileOpen(true)}><Menu size={21}/></button>
        <div className="header-spacer"/>
        {mode === 'demo' && <span className="demo-pill">Modo demonstração</span>}
        <button className="icon-btn" title="Atualizar" disabled={syncing} onClick={()=>refresh()}><RefreshCw size={18} className={syncing ? 'spin' : ''}/></button>
        <button className="icon-btn" title="Notificações"><Bell size={18}/></button>
      </header>
      <div className="content">
        <div className="page-heading"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</div>
        {children}
      </div>
    </main>
  </div>;
}
