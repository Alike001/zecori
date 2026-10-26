import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Bot, BookOpen, CircleUserRound, Clock3, FileCheck2, Inbox, Route, Settings } from 'lucide-react';
import { DOCS_PAGES, docsPage } from './lib/docs-content.ts';
import { PRODUCT_CAPABILITIES, productCapability, type FeatureStatus } from './lib/product-capabilities.ts';
import { ROUTE_CAPABILITIES } from './lib/route-capabilities.ts';
import { localeDirection, localeMetadata, translate, type SupportedLocale } from './lib/i18n.ts';
import { BrandWordmark, ThemeToggle, ZecoriMark } from './Brand.tsx';

type Navigate = (path: string) => void;

export function FeatureStatusBadge({ status }: { status: FeatureStatus }) {
  return <span className={`truth-badge truth-${status.toLowerCase().replaceAll(/[^a-z]+/g, '-')}`}>{status}</span>;
}

const appNavigation = [
  { id: 'routes', label: 'Routes', href: '/swap', icon: Route },
  { id: 'account', label: 'Account', href: '/account', icon: CircleUserRound },
  { id: 'activity', label: 'Activity', href: '/activity', icon: Clock3 },
  { id: 'assistant', label: 'AI assistant', href: '/assistant', icon: Bot },
] as const;

export function ProductHeader({ current, navigate }: { current: string; navigate: Navigate }) {
  return <header className="product-header"><button className="brand brand-button" onClick={() => navigate('/')} aria-label="Zecori home"><BrandWordmark/></button>
    <nav className="product-nav" aria-label="Product navigation">{appNavigation.map(item => { const Icon = item.icon; return <a key={item.id} href={item.href} aria-current={current === item.id ? 'page' : undefined} onClick={event => { event.preventDefault(); navigate(item.href); }}><Icon size={16}/>{item.label}</a>; })}
      <span className="nav-disabled" aria-disabled="true" title="Planned — no inbox service exists"><Inbox size={16}/>Inbox <small>planned</small></span>
      <span className="nav-disabled" aria-disabled="true" title="Planned — no settings API exists"><Settings size={16}/>Settings <small>planned</small></span>
    </nav>
    <div className="product-meta"><span className="network-lock"><span/>Testnet only</span><ThemeToggle/><a className="docs-link" href="/docs/getting-started" onClick={event => { event.preventDefault(); navigate('/docs/getting-started'); }}><BookOpen size={16}/>Docs</a></div>
  </header>;
}

export function ProductPage({ current, navigate, children }: { current: string; navigate: Navigate; children: ReactNode }) {
  return <div className="page product-page"><a className="skip-link" href="#main">Skip to content</a><ProductHeader current={current} navigate={navigate}/><main id="main" className="main compact-page product-main">{children}</main></div>;
}

export function AccountSurface({ navigate, identity }: { navigate: Navigate; identity: ReactNode }) {
  return <ProductPage current="account" navigate={navigate}><div className="surface-heading"><span className="kicker">Account</span><h1>Your private access boundary.</h1><p>Identity opens owner-scoped history. It never changes who owns settlement records or grants wallet authority.</p></div>{identity}<section className="surface-note"><FeatureStatusBadge status={productCapability('passkey-auth').status}/><h2>Recovery is additive</h2><p>Add another passkey while signed in. Accounts are never merged automatically by email, display name, or wallet address.</p></section></ProductPage>;
}

export function AssistantSurface({ navigate, assistant }: { navigate: Navigate; assistant: ReactNode }) {
  return <ProductPage current="assistant" navigate={navigate}><div className="surface-heading"><span className="kicker">AI route desk</span><h1>Ask for facts, not execution.</h1><p>Every financial answer must be grounded in an allow-listed tool. The assistant has no order, wallet, signing, allocation, or payout authority.</p></div><div className="assistant-surface">{assistant}<aside className="surface-note"><FeatureStatusBadge status={productCapability('ai-groq').status}/><h2>External model boundary</h2><p>Without separately approved credentials, the assistant stays deterministic. Chat and future voice share the same policy contract.</p></aside></div></ProductPage>;
}

function RouteTruth() {
  return <div className="docs-route-list">{ROUTE_CAPABILITIES.map(route => <article key={route.id}><span className={`capability-state ${route.availability}`}>{route.availability.replaceAll('-', ' ')}</span><h3>{route.title}</h3><p>{route.summary}</p><small>{route.disclosure}</small></article>)}</div>;
}

function FeatureTruthMatrix() {
  return <div className="truth-matrix">{PRODUCT_CAPABILITIES.map(feature => <article key={feature.id}><div><h3>{feature.title}</h3><FeatureStatusBadge status={feature.status}/></div><p>{feature.summary}</p><small>{feature.evidence}</small></article>)}</div>;
}

export function DocsSite({ pathname, navigate, locale }: { pathname: string; navigate: Navigate; locale: SupportedLocale }) {
  const slug = pathname.replace(/^\/docs\/?/, '') || 'getting-started';
  const page = docsPage(slug);
  if (!page) return <NotFound navigate={navigate}/>;
  const features = page.featureIds.map(productCapability);
  return <div className="docs-page" lang={locale} dir={localeDirection(locale)}><a className="skip-link" href="#docs-main">Skip to documentation</a><header className="docs-header"><button className="brand brand-button" onClick={() => navigate('/')} aria-label="Zecori home"><BrandWordmark context="Documentation"/></button><div className="docs-header-actions"><ThemeToggle/><button className="subtle-button" onClick={() => navigate('/swap')}>Open product <ArrowRight size={15}/></button></div></header>
    <div className="docs-layout"><aside className="docs-sidebar"><div><span className="kicker">Product manual</span><strong>Truth before breadth.</strong></div><nav aria-label="Documentation">{DOCS_PAGES.map(item => <a key={item.slug} href={`/docs/${item.slug}`} aria-current={item.slug === page.slug ? 'page' : undefined} onClick={event => { event.preventDefault(); navigate(`/docs/${item.slug}`); }}>{item.title}</a>)}</nav><button className="text-button" onClick={() => navigate('/')}><ArrowLeft size={14}/>Back to homepage</button></aside>
      <main id="docs-main" className="docs-content"><div className="docs-title"><span className="kicker">{page.eyebrow}</span><h1>{page.title}</h1><p>{page.summary}</p><p className="locale-disclosure">{translate(locale, 'docsLanguageNotice')} · {locale.toUpperCase()} security copy: {localeMetadata[locale].translationReview.replaceAll('-', ' ')}.</p><div className="docs-statuses">{features.map(feature => <span key={feature.id}><FeatureStatusBadge status={feature.status}/>{feature.title}</span>)}</div></div>
        {page.sections.map(section => <section className="docs-section reveal" key={section.title}><h2>{section.title}</h2><p>{section.body}</p>{section.bullets && <ul>{section.bullets.map(item => <li key={item}>{item}</li>)}</ul>}</section>)}
        {page.slug === 'route-availability' && <section className="docs-section"><h2>Registry entries</h2><RouteTruth/></section>}
        {page.slug === 'evidence' && <section className="docs-section"><h2>Feature truth matrix</h2><FeatureTruthMatrix/></section>}
        {page.slug === 'ai-and-voice' && <section className="docs-section"><h2>Per-language support matrix</h2><div className="language-matrix" role="table" aria-label="Language support"><div role="row"><strong role="columnheader">Language</strong><strong role="columnheader">UI</strong><strong role="columnheader">AI text</strong><strong role="columnheader">Recognition</strong><strong role="columnheader">Voice output</strong></div><div role="row"><span>English</span><span>Partial · human reviewed</span><span>Supported</span><span>Configured · untested live</span><span>Configured · untested live</span></div><div role="row"><span>French</span><span>Partial · review required</span><span>Supported</span><span>Configured · untested live</span><span>Text only</span></div><div role="row"><span>Arabic</span><span>Partial RTL · review required</span><span>Supported</span><span>Configured · untested live</span><span>Saudi Arabic · untested live</span></div></div><p className="token-integrity">Addresses, TAZ, USDC, chain IDs, and transaction hashes are never machine-translated.</p></section>}
        {page.slug === 'brand-system' && <section className="docs-section brand-system"><h2>Private-origin route mark</h2><div className="brand-mark-specimen"><ZecoriMark/><div><strong>Zecori</strong><span>Your Zcash. More possibilities.</span></div></div><p>The concealed origin circle represents the shielded Zcash source. The split route exits into two evidence points, representing the transparent destination and its independently checked receipt. It is intentionally not a Z, shield, or chain link.</p></section>}
        <nav className="docs-next" aria-label="Adjacent documentation">{(() => { const index = DOCS_PAGES.findIndex(item => item.slug === page.slug); const next = DOCS_PAGES[index + 1]; return next ? <button className="primary-button" onClick={() => navigate(`/docs/${next.slug}`)}>Next: {next.title}<ArrowRight size={16}/></button> : <button className="primary-button" onClick={() => navigate('/swap')}>Explore the test route<ArrowRight size={16}/></button>; })()}</nav>
      </main></div>
  </div>;
}

export function NotFound({ navigate }: { navigate: Navigate }) {
  return <div className="not-found"><ZecoriMark/><span className="kicker">404 · no route here</span><h1>This path is not registered.</h1><p>No fallback financial route was selected. Return to the verified product surface.</p><button className="primary-button" onClick={() => navigate('/')}>Return home</button></div>;
}

export function EvidenceLink({ navigate }: { navigate: Navigate }) {
  return <button className="text-button" onClick={() => navigate('/docs/evidence')}><FileCheck2 size={15}/>Review evidence</button>;
}
