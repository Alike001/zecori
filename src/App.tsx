import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, Check, CircleAlert, Clock3, LockKeyhole, MicOff, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { createOrderRequest, getCapabilities, listOrderRequests, type PublicCapabilities, type PublicOrderRequest } from './lib/order-api.ts';
import { respondToAgent, type AgentReply } from './lib/agent-capabilities.ts';
import { voiceAvailability } from './lib/voice.ts';
import { resolveLocale, translate } from './lib/i18n.ts';

function navigate(path: string): void { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }
function short(value: string): string { return `${value.slice(0, 8)}…${value.slice(-6)}`; }
function label(value: string): string { return value.split('_').map(word => word[0] + word.slice(1).toLowerCase()).join(' '); }

const stages = ['Request reviewed', 'Payment instructions', 'Zcash confirmed', 'Payout approved', 'Base verified'];

function RequestCard({ request, onRefresh }: { request: PublicOrderRequest; onRefresh: () => void }) {
  const stage = request.status === 'AWAITING_OPERATOR' ? 0 : request.status === 'PAYMENT_READY' ? 1 : request.status === 'LINKED' ? 2 : 0;
  return <section className="panel request-card" aria-live="polite">
    <div className="panel-top"><span className="section-label">YOUR PAYMENT REQUEST</span><span className={`status-chip status-${request.status.toLowerCase()}`}>{label(request.status)}</span></div>
    <div className="request-id"><span>Request ID</span><code>{request.id}</code><button className="icon-button" onClick={onRefresh} aria-label="Refresh request status"><RefreshCw size={16}/></button></div>
    <ol className="timeline">{stages.map((item, index) => <li className={index <= stage ? 'reached' : ''} key={item}><span>{index < stage ? <Check size={14}/> : index + 1}</span><div><strong>{item}</strong><small>{index === 0 ? 'A trusted operator must accept and bind this exact request.' : index === 1 ? 'Shown only after a fresh shielded receiver is durably reserved.' : 'Requires independent network evidence.'}</small></div></li>)}</ol>
    {request.paymentInstructions ? <div className="payment-instructions"><strong>Shielded testnet payment receiver</strong><code>{request.paymentInstructions.receiver}</code><p>Send exactly 0.01 TAZ before {new Date(request.paymentInstructions.expiresAt).toLocaleString()}. Confirm source-wallet funding separately before paying.</p></div> : <div className="waiting"><Clock3 size={18}/><div><strong>No payment address yet</strong><p>Do not send funds. The operator has not completed the separately authorized allocation.</p></div></div>}
  </section>;
}

function History({ requests }: { requests: PublicOrderRequest[] }) {
  return <main className="main compact-page"><div className="page-nav"><button className="subtle-button" onClick={() => navigate('/')}><ArrowLeft size={15}/> Route</button><span className="mode">PRIVATE SESSION HISTORY</span></div>
    <div className="eyebrow"><span className="eyebrow-bar"/> REQUEST LEDGER</div><h1>Your route<br/><span>requests.</span></h1>
    <p className="lead">This browser session shows requests it created. A request is not a payment, payout, or verified settlement receipt.</p>
    <section className="panel history-table">{requests.length ? requests.map(request => <div className="history-row-static" key={request.id}><div><strong>{short(request.id)}</strong><small>0.01 TAZ → 1 test USDC</small></div><div><small>Created</small><strong>{new Date(request.createdAt).toLocaleString()}</strong></div><span className={`status-chip status-${request.status.toLowerCase()}`}>{label(request.status)}</span></div>) : <div className="empty-state">No requests exist in this browser session.</div>}</section>
  </main>;
}

function AgentPanel({ capabilities, request }: { capabilities: PublicCapabilities | null; request?: PublicOrderRequest }) {
  const [message, setMessage] = useState('');
  const [conversation, setConversation] = useState<AgentReply[]>([{ text: 'Ask me about this route, shielded privacy, custody, refunds, or request status.' }]);
  function submit(event: React.FormEvent) {
    event.preventDefault(); if (!message.trim()) return;
    const reply = respondToAgent(message, { route: capabilities?.route, request });
    setConversation(items => [...items, { text: message }, reply]); setMessage('');
  }
  return <section className="panel agent-panel"><div className="panel-top"><span className="section-label"><Bot size={14}/> ROUTE ASSISTANT</span><span className="small-chip muted">No execution authority</span></div>
    <div className="conversation" aria-live="polite">{conversation.slice(-5).map((item, index) => <p className={index % 2 ? 'agent-answer' : 'agent-prompt'} key={`${item.text}-${index}`}>{item.text}</p>)}</div>
    <form className="agent-form" onSubmit={submit}><label><span className="sr-only">Ask the route assistant</span><input value={message} onChange={event => setMessage(event.target.value)} maxLength={500} placeholder="Ask: Why is this route custodial?"/></label><button className="icon-button" aria-label="Send message"><Send size={17}/></button></form>
    <div className="voice-disabled"><MicOff size={15}/><span>{voiceAvailability.reason}</span></div>
  </section>;
}

export default function App() {
  const locale = resolveLocale(navigator.language);
  const [route, setRoute] = useState(window.location.pathname);
  const [capabilities, setCapabilities] = useState<PublicCapabilities | null>(null);
  const [requests, setRequests] = useState<PublicOrderRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const handler = () => setRoute(window.location.pathname); window.addEventListener('popstate', handler); return () => window.removeEventListener('popstate', handler); }, []);
  useEffect(() => { void Promise.all([getCapabilities(), listOrderRequests()]).then(([next, history]) => { setCapabilities(next); setRequests(history); }).catch(caught => setError(caught instanceof Error ? caught.message : 'Service unavailable')); }, []);
  const active = useMemo(() => requests.find(item => ['AWAITING_OPERATOR', 'PAYMENT_READY', 'LINKED'].includes(item.status)), [requests]);
  async function create() { setBusy(true); setError(null); try { const request = await createOrderRequest(); setRequests(items => [request, ...items.filter(item => item.id !== request.id)]); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Request failed'); } finally { setBusy(false); } }
  async function refresh() { if (!active) return; setBusy(true); try { const history = await listOrderRequests(); setRequests(history); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Refresh failed'); } finally { setBusy(false); } }
  if (route === '/history') return <History requests={requests}/>;
  const terms = capabilities?.route;
  return <div className="page"><header className="header"><button className="brand brand-button" onClick={() => navigate('/')}><span className="brand-symbol"><ShieldCheck size={20}/></span><span>ZECATHON <small>PRIVATE ROUTES</small></span></button><div className="header-side"><span className="mode">TESTNET · OPERATOR APPROVED</span><span className="status-dot"/></div></header>
    <main className="main"><div className="eyebrow"><span className="eyebrow-bar"/> ONE VERIFIED ROUTE / NO MARKET CLAIMS</div><h1>{translate(locale, 'heroTitle')}<br/><span>{translate(locale, 'heroAccent')}</span></h1>
      <p className="lead">{translate(locale, 'heroBody')}</p>
      <div className="safety-notice"><LockKeyhole size={17}/><span>Mainnet and automatic payouts are disabled. Every settlement step requires deterministic policy and independent evidence.</span></div>
      <div className="page-actions"><button className="subtle-button" onClick={() => navigate('/history')}>{translate(locale, 'history')}</button></div>
      {error && <div className="inline-warning" role="alert"><CircleAlert size={17}/>{error}</div>}
      <section className="route-shell panel"><div className="panel-top"><span className="section-label">SUPPORTED ROUTE</span><span className="small-chip">Fixed test terms</span></div>
        <div className="route-pair"><div className="route-side"><small>SOURCE</small><strong>{terms?.source.amount ?? '0.01'} TAZ</strong><span>Zcash testnet · Ironwood shielded</span><code>1,000,000 zatoshis</code></div><div className="route-arrow"><ArrowRight/></div><div className="route-side"><small>DESTINATION</small><strong>{terms?.destination.amount ?? '1'} test USDC</strong><span>Base Sepolia · chain 84532</span><code>{capabilities ? short(capabilities.destinationRecipient) : 'Loading recipient…'}</code></div></div>
        <div className="terms-grid"><div><small>Exchange basis</small><p>{terms?.rate.description ?? 'Loading exact terms…'}</p></div><div><small>Confirmations</small><p>{terms ? `${terms.source.confirmations} Zcash · ${terms.destination.confirmations} Base` : 'Loading…'}</p></div><div><small>Provider model</small><p>Trusted testnet liquidity provider · manual approval</p></div></div>
        <details><summary>Custody, late-payment and refund limits</summary><p>{terms?.custody}</p><p>{terms?.refunds}</p></details>
        {!active && <button className="primary-button request-button" disabled={!capabilities || busy} onClick={() => void create()}>{busy ? 'Creating scoped request…' : translate(locale, 'requestReview')}<ArrowRight size={17}/></button>}
        <p className="fine-print">Creating a request allocates no address, moves no funds, and gives the assistant no transaction authority.</p>
      </section>
      {active && <RequestCard request={active} onRefresh={() => void refresh()}/>}<AgentPanel capabilities={capabilities} request={active}/>
      <footer className="footer"><span>Original Zecathon testnet application</span><span>English UI · voice disabled pending privacy review</span></footer>
    </main></div>;
}
