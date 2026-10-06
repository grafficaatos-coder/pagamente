import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  CheckCircle2,
  Clock3,
  CreditCard,
  FileText,
  Landmark,
  Mail,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UsersRound,
  WalletCards,
  Zap
} from 'lucide-react';
import styles from './page.module.css';
import AgendaRecoveryRedirect from '../../components/AgendaRecoveryRedirect';

const features = [
  {
    icon: UsersRound,
    title: 'Clientes organizados',
    text: 'Cadastre clientes, documentos, contatos e preferências de envio em um só lugar.'
  },
  {
    icon: CreditCard,
    title: 'Boleto e Pix',
    text: 'Crie cobranças com boleto, Pix ou as duas opções, conforme a integração escolhida.'
  },
  {
    icon: RefreshCw,
    title: 'Cobranças recorrentes',
    text: 'Organize cobranças periódicas e acompanhe o que está previsto para receber.'
  },
  {
    icon: WalletCards,
    title: 'Conta digital integrada',
    text: 'Consulte saldo e opere Pix pelo JP Sistema quando a Conta Digital Asaas estiver ativada.'
  },
  {
    icon: Mail,
    title: 'Envio ao cliente',
    text: 'Facilite o envio de cobranças por e-mail e WhatsApp, com links de pagamento.'
  },
  {
    icon: BarChart3,
    title: 'Relatórios e visão financeira',
    text: 'Acompanhe recebidos, pendentes, vencidos e a movimentação da sua operação.'
  }
];

const steps = [
  ['1', 'Cadastre sua empresa e clientes', 'Centralize os dados essenciais para começar a cobrar.'],
  ['2', 'Crie a cobrança', 'Escolha o valor, vencimento e a forma de pagamento disponível.'],
  ['3', 'Envie ao cliente', 'Compartilhe o pagamento por e-mail, WhatsApp ou link.'],
  ['4', 'Acompanhe o recebimento', 'Veja o status das cobranças e mantenha a gestão em dia.']
];

export default function SitePage() {
  return (
    <main className={styles.page}>
      <AgendaRecoveryRedirect />
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brand} aria-label="JP Sistema de Cobrança">
            <img src="/jp-sistema-cobranca-logo.webp" alt="JP Sistema de Cobrança" />
          </Link>

          <nav className={styles.nav} aria-label="Navegação principal">
            <a href="#recursos">Recursos</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#integracoes">Integrações</a>
            <a href="#seguranca">Segurança</a>
          </nav>

          <div className={styles.headerActions}>
            <Link href="/sistema" className={styles.loginBtn}>Entrar</Link>
            <Link href="/sistema" className={styles.primaryBtn}>Começar agora <ArrowRight size={17} /></Link>
          </div>
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroGlowOne} />
        <div className={styles.heroGlowTwo} />

        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <div className={styles.kicker}><Zap size={15} /> Gestão de cobranças para empresas</div>
            <h1>Cobranças organizadas.<br /><span>Recebimentos sob controle.</span></h1>
            <p>
              O JP Sistema de Cobrança reúne clientes, cobranças, recorrências, Pix,
              boleto, relatórios e integrações financeiras em um painel simples de usar.
            </p>

            <div className={styles.heroActions}>
              <Link href="/sistema" className={styles.heroPrimary}>Acessar o sistema <ArrowRight size={19} /></Link>
              <a href="#recursos" className={styles.heroSecondary}>Conhecer recursos</a>
            </div>

            <div className={styles.heroChecks}>
              <span><CheckCircle2 size={16} /> Boleto e Pix</span>
              <span><CheckCircle2 size={16} /> Recorrências</span>
              <span><CheckCircle2 size={16} /> E-mail e WhatsApp</span>
            </div>
          </div>

          <div className={styles.heroVisual} aria-label="Prévia do painel JP Sistema">
            <div className={styles.previewWindow}>
              <div className={styles.previewTop}>
                <div className={styles.previewLogo}><img src="/jp-sistema-cobranca-logo.webp" alt="" /></div>
                <div className={styles.previewDots}><i /><i /><i /></div>
              </div>
              <div className={styles.previewBody}>
                <aside className={styles.previewSidebar}>
                  <span className={styles.previewActive}>Visão geral</span>
                  <span>Clientes</span>
                  <span>Cobranças</span>
                  <span>Recorrências</span>
                  <span>Conta digital</span>
                  <span>Relatórios</span>
                </aside>
                <div className={styles.previewContent}>
                  <div className={styles.previewHeading}>
                    <div><small>VISÃO FINANCEIRA</small><strong>Painel da empresa</strong></div>
                    <button>+ Nova cobrança</button>
                  </div>
                  <div className={styles.metricGrid}>
                    <div><small>Recebidas</small><strong>R$ 12.480</strong><span>pagamentos confirmados</span></div>
                    <div><small>Aguardando</small><strong>R$ 4.250</strong><span>cobranças em aberto</span></div>
                    <div><small>Vencidas</small><strong>R$ 890</strong><span>precisam de atenção</span></div>
                  </div>
                  <div className={styles.chartCard}>
                    <div className={styles.chartTitle}><span>Movimentação mensal</span><small>últimos meses</small></div>
                    <div className={styles.chart}>
                      <i style={{height:'36%'}} />
                      <i style={{height:'52%'}} />
                      <i style={{height:'44%'}} />
                      <i style={{height:'70%'}} />
                      <i style={{height:'62%'}} />
                      <i style={{height:'88%'}} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.floatingCardOne}><ShieldCheck size={20} /><div><strong>Operação organizada</strong><span>dados separados por empresa</span></div></div>
            <div className={styles.floatingCardTwo}><Smartphone size={20} /><div><strong>Pix + boleto</strong><span>mais opções para receber</span></div></div>
          </div>
        </div>
      </section>

      <section className={styles.trustStrip}>
        <div><ShieldCheck size={20}/><span>Controle por empresa</span></div>
        <div><Clock3 size={20}/><span>Acompanhamento de status</span></div>
        <div><Landmark size={20}/><span>Integrações financeiras</span></div>
        <div><MessageCircle size={20}/><span>Comunicação facilitada</span></div>
      </section>

      <section id="recursos" className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.eyebrow}>RECURSOS</span>
          <h2>Tudo o que você precisa para cobrar com mais organização</h2>
          <p>Da criação da cobrança ao acompanhamento do recebimento, o fluxo fica centralizado no JP Sistema.</p>
        </div>

        <div className={styles.featureGrid}>
          {features.map(({icon: Icon,title,text}) => (
            <article className={styles.featureCard} key={title}>
              <div className={styles.featureIcon}><Icon size={23}/></div>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="como-funciona" className={styles.howSection}>
        <div className={styles.howInner}>
          <div className={styles.sectionHeadLeft}>
            <span className={styles.eyebrow}>COMO FUNCIONA</span>
            <h2>Um fluxo simples para sua equipe e para seus clientes</h2>
            <p>Você administra a operação no JP Sistema e o cliente recebe uma experiência de pagamento direta.</p>
          </div>

          <div className={styles.steps}>
            {steps.map(([number,title,text]) => (
              <div className={styles.step} key={number}>
                <div className={styles.stepNumber}>{number}</div>
                <div><h3>{title}</h3><p>{text}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="integracoes" className={styles.section}>
        <div className={styles.integrationLayout}>
          <div className={styles.integrationCopy}>
            <span className={styles.eyebrow}>INTEGRAÇÕES</span>
            <h2>Conecte o JP Sistema aos provedores da sua operação</h2>
            <p>
              O sistema foi preparado para trabalhar com integrações como Asaas e Mercado Pago,
              permitindo centralizar a gestão sem misturar os dados de empresas diferentes.
            </p>
            <div className={styles.integrationList}>
              <div><Landmark size={19}/><span><strong>Asaas</strong><small>Conta digital integrada, cobranças e Pix conforme habilitação.</small></span></div>
              <div><CreditCard size={19}/><span><strong>Mercado Pago</strong><small>Opções de cobrança integradas à operação do sistema.</small></span></div>
              <div><FileText size={19}/><span><strong>Webhooks</strong><small>Atualização de status para manter o painel sincronizado.</small></span></div>
            </div>
          </div>

          <div className={styles.integrationVisual}>
            <div className={styles.centerNode}><img src="/jp-sistema-cobranca-logo.webp" alt="JP Sistema" /></div>
            <div className={styles.node + ' ' + styles.nodeTop}><Landmark size={24}/><strong>Asaas</strong></div>
            <div className={styles.node + ' ' + styles.nodeRight}><CreditCard size={24}/><strong>Mercado Pago</strong></div>
            <div className={styles.node + ' ' + styles.nodeBottom}><Mail size={24}/><strong>E-mail</strong></div>
            <div className={styles.node + ' ' + styles.nodeLeft}><MessageCircle size={24}/><strong>WhatsApp</strong></div>
            <span className={styles.orbitOne}/>
            <span className={styles.orbitTwo}/>
          </div>
        </div>
      </section>

      <section id="seguranca" className={styles.securitySection}>
        <div className={styles.securityInner}>
          <div className={styles.securityIcon}><ShieldCheck size={32}/></div>
          <div className={styles.securityCopy}>
            <span className={styles.eyebrow}>SEGURANÇA E ORGANIZAÇÃO</span>
            <h2>Cada empresa com seus próprios dados e sua própria operação</h2>
            <p>
              O JP Sistema foi estruturado para separar informações por empresa, controlar acessos da equipe
              e proteger credenciais de integrações no servidor.
            </p>
          </div>
          <div className={styles.securityChecks}>
            <span><Check size={17}/> Separação por empresa</span>
            <span><Check size={17}/> Perfis de acesso</span>
            <span><Check size={17}/> Credenciais protegidas</span>
            <span><Check size={17}/> Histórico de atividades</span>
          </div>
        </div>
      </section>

      <section className={styles.ctaSection}>
        <div className={styles.ctaCard}>
          <div>
            <span className={styles.eyebrowLight}>JP SISTEMA DE COBRANÇA</span>
            <h2>Leve sua cobrança para um painel único.</h2>
            <p>Organize clientes, cobranças, recebimentos e equipe sem depender de controles espalhados.</p>
          </div>
          <Link href="/sistema" className={styles.ctaButton}>Acessar o sistema <ArrowRight size={19}/></Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <img src="/jp-sistema-cobranca-logo.webp" alt="JP Sistema de Cobrança"/>
          <p>Gestão de cobranças feita para empresas que querem mais controle.</p>
        </div>
        <div className={styles.footerLinks}>
          <a href="#recursos">Recursos</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#integracoes">Integrações</a>
          <Link href="/sistema">Entrar</Link>
        </div>
        <p className={styles.legal}>
          O JP Sistema de Cobrança é uma plataforma de software. Serviços financeiros e processamento de pagamentos
          são realizados pelos provedores integrados, conforme contratação e disponibilidade.
        </p>
      </footer>
    </main>
  );
}
