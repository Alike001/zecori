import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, Check, CircleAlert, Clock3, KeyRound, LockKeyhole, LogOut, MicOff, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { createOrderRequest, getCapabilities, getSession, listOrderRequests, loginWithPasskey, logout, registerPasskey, type PublicCapabilities, type PublicOrderRequest, type UserSession } from './lib/order-api.ts';
import { respondToAgent, type AgentReply } from './lib/agent-capabilities.ts';
import { voiceAvailability } from './lib/voice.ts';
import { resolveLocale, translate } from './lib/i18n.ts';

function navigate(path: string): void { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }
function short(value: string): string { return `${value.slice(0, 8)}…${value.slice(-6)}`; }
function label(value: string): string { return value.split('_').map(word => word[0] + word.slice(1).toLowerCase()).join(' '); }

const stages = ['Operator review', 'Payment instructions', 'Source verification', 'Payout review', 'Destination verification', 'Verified receipt'];

const stageByStatus: Record<PublicOrderRequest['status'], number> = {
  AWAITING_OPERATOR: 0, ACCEPTED: 1, PAYMENT_READY: 1, SOURCE_DETECTED: 2, SOURCE_CONFIRMED: 3,
  PAYOUT_AWAITING_APPROVAL: 3, PAYOUT_SUBMITTED: 4, COMPLETED: 6, FAILED: 0, REFUND_PENDING: 2,
  REFUNDED: 2, UNRESOLVED: 2, EXPIRED: 0, CANCELLED: 0,
};

function RequestCard({ request, onRefresh }: { request: PublicOrderRequest; onRefresh: () => void }) {
  const stage = stageByStatus[request.status];
  return <section className="panel request-card" aria-live="polite">
    <div className="panel-top"><span className="section-label">YOUR PAYMENT REQUEST</span><span className={`status-chip status-${request.status.toLowerCase()}`}>{label(request.status)}</span></div>
    <div className="request-id"><span>Request ID</span><code>{request.id}</code><button className="icon-button" onClick={onRefresh} aria-label="Refresh request status"><RefreshCw size={16}/></button></div>
    <ol className="timeline">{stages.map((item, index) => <li className={index < stage ? 'reached' : ''} key={item}><span>{index < stage ? <Check size={14}/> : index + 1}</span><div><strong>{item}</strong><small>{index === 0 ? 'A trusted operator must accept and sign this exact request.' : index === 1 ? 'Shown only after a shielded receiver is independently validated and durably reserved.' : 'Requires an operator-controlled transition and independent network evidence.'}</small></div></li>)}</ol>
    {request.paymentInstructions ? <div className="payment-instructions"><strong>Shielded testnet payment receiver</strong><code>{request.paymentInstructions.receiver}</code><p>Send exactly 0.01 TAZ before {new Date(request.paymentInstructions.expiresAt).toLocaleString()}. Confirm source-wallet funding separately before paying.</p></div> : <div className="waiting"><Clock3 size={18}/><div><strong>No payment address yet</strong><p>Do not send funds. The operator has not completed the independently validated allocation.</p></div></div>}
    {request.order?.resolutionReason && <div className="inline-warning"><CircleAlert size={17}/><span>{request.order.resolutionReason}</span></div>}
    {request.timeline?.length ? <details><summary>Observable transaction timeline</summary><ol className="event-timeline">{request.timeline.map((event, index) => <li key={`${event.at}-${index}`}><strong>{label(event.type)}</strong><small>{new Date(event.at).toLocaleString()} · {label(event.actor)}</small></li>)}</ol></details> : null}
  </section>;
}

function History({ requests }: { requests: PublicOrderRequest[] }) {
  return <main className="main compact-page"><div className="page-nav"><button className="subtle-button" onClick={() => navigate('/')}><ArrowLeft size={15}/> Route</button><span className="mode">PRIVATE SESSION HISTORY</span></div>
    <div className="eyebrow"><span className="eyebrow-bar"/> REQUEST LEDGER</div><h1>Your route<br/><span>requests.</span></h1>
    <p className="lead">Your passkey account retains this history across securely authenticated sessions. A request is not a payment, payout, or verified settlement receipt.</p>
    <section className="panel history-table">{requests.length ? requests.map(request => <div className="history-row-static" key={request.id}><div><strong>{short(request.id)}</strong><small>0.01 TAZ → 1 test USDC</small></div><div><small>Created</small><strong>{new Date(request.createdAt).toLocaleString()}</strong></div><span className={`status-chip status-${request.status.toLowerCase()}`}>{label(request.status)}</span></div>) : <div className="empty-state">No requests exist for this account.</div>}</section>
  </main>;
}

function IdentityPanel({ session, busy, onRegister, onLogin, onAdd, onLogout }: { session: UserSession; busy: boolean; onRegister: (name: string) => void; onLogin: () => void; onAdd: () => void; onLogout: () => void }) {
  const [name, setName] = useState('');
  if (session.authenticated) return <section className="panel identity-panel"><div><span className="section-label"><KeyRound size={14}/> PASSKEY ACCOUNT</span><p><strong>{session.user?.displayName}</strong> · {session.user?.passkeyCount} registered passkey{session.user?.passkeyCount === 1 ? '' : 's'}</p><small>Register at least two passkeys so another authenticator can recover access.</small></div><div className="identity-actions"><button className="subtle-button" disabled={busy} onClick={onAdd}>Add passkey</button><button className="subtle-button" disabled={busy} onClick={onLogout}><LogOut size={15}/> Logout</button></div></section>;
  return <section className="panel identity-panel"><div className="panel-top"><span className="section-label"><KeyRound size={14}/> RECOVERABLE IDENTITY</span><span className="small-chip">Passkeys only</span></div><p>Register or sign in before creating a request. No email or recovery-token shortcut is available.</p><div className="identity-form"><label><span>Account name</span><input value={name} maxLength={80} autoComplete="name" onChange={event => setName(event.target.value)} placeholder="Private account label"/></label><button className="primary-button" disabled={busy || !name.trim()} onClick={() => onRegister(name)}>Create with passkey</button><button className="subtle-button" disabled={busy} onClick={onLogin}>Sign in with passkey</button></div></section>;
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
  const [session, setSession] = useState<UserSession>({ authenticated: false });
  const [requests, setRequests] = useState<PublicOrderRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const handler = () => setRoute(window.location.pathname); window.addEventListener('popstate', handler); return () => window.removeEventListener('popstate', handler); }, []);
  useEffect(() => { void Promise.all([getCapabilities(), getSession()]).then(async ([next, identity]) => { setCapabilities(next); setSession(identity); setRequests(identity.authenticated ? await listOrderRequests() : []); }).catch(caught => setError(caught instanceof Error ? caught.message : 'Service unavailable')); }, []);
  const active = useMemo(() => requests.find(item => !['COMPLETED', 'FAILED', 'REFUNDED', 'EXPIRED', 'CANCELLED'].includes(item.status)), [requests]);
  async function create() { setBusy(true); setError(null); try { const request = await createOrderRequest(); setRequests(items => [request, ...items.filter(item => item.id !== request.id)]); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Request failed'); } finally { setBusy(false); } }
  async function refresh() { if (!active) return; setBusy(true); try { const history = await listOrderRequests(); setRequests(history); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Refresh failed'); } finally { setBusy(false); } }
  async function reloadIdentity() { const identity = await getSession(); setSession(identity); setRequests(identity.authenticated ? await listOrderRequests() : []); }
  async function register(name: string) { setBusy(true); setError(null); try { await registerPasskey(name, 'Primary passkey'); await reloadIdentity(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Passkey registration failed'); } finally { setBusy(false); } }
  async function login() { setBusy(true); setError(null); try { await loginWithPasskey(); await reloadIdentity(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Passkey login failed'); } finally { setBusy(false); } }
  async function addPasskey() { setBusy(true); setError(null); try { await registerPasskey(session.user?.displayName ?? 'Zecathon account', `Additional passkey ${session.user?.passkeyCount ? session.user.passkeyCount + 1 : 2}`, true); await reloadIdentity(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Passkey registration failed'); } finally { setBusy(false); } }
  async function signOut() { setBusy(true); setError(null); try { await logout(); await reloadIdentity(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Logout failed'); } finally { setBusy(false); } }
  if (route === '/history') return <History requests={requests}/>;
  const terms = capabilities?.route;
  return <div className="page"><header className="header"><button className="brand brand-button" onClick={() => navigate('/')}><span className="brand-symbol"><ShieldCheck size={20}/></span><span>ZECATHON <small>PRIVATE ROUTES</small></span></button><div className="header-side"><span className="mode">TESTNET · OPERATOR APPROVED</span><span className="status-dot"/></div></header>
    <main className="main"><div className="eyebrow"><span className="eyebrow-bar"/> ONE VERIFIED ROUTE / NO MARKET CLAIMS</div><h1>{translate(locale, 'heroTitle')}<br/><span>{translate(locale, 'heroAccent')}</span></h1>
      <p className="lead">{translate(locale, 'heroBody')}</p>
      <div className="safety-notice"><LockKeyhole size={17}/><span>Mainnet and automatic payouts are disabled. Every settlement step requires deterministic policy and independent evidence.</span></div>
      <div className="page-actions"><button className="subtle-button" onClick={() => navigate('/history')}>{translate(locale, 'history')}</button></div>
      {error && <div className="inline-warning" role="alert"><CircleAlert size={17}/>{error}</div>}
      <IdentityPanel session={session} busy={busy} onRegister={name => void register(name)} onLogin={() => void login()} onAdd={() => void addPasskey()} onLogout={() => void signOut()}/>
      <section className="route-shell panel"><div className="panel-top"><span className="section-label">SUPPORTED ROUTE</span><span className="small-chip">Fixed test terms</span></div>
        <div className="route-pair"><div className="route-side"><small>SOURCE</small><strong>{terms?.source.amount ?? '0.01'} TAZ</strong><span>Zcash testnet · Ironwood shielded</span><code>1,000,000 zatoshis</code></div><div className="route-arrow"><ArrowRight/></div><div className="route-side"><small>DESTINATION</small><strong>{terms?.destination.amount ?? '1'} test USDC</strong><span>Base Sepolia · chain 84532</span><code>{capabilities ? short(capabilities.destinationRecipient) : 'Loading recipient…'}</code></div></div>
        <div className="terms-grid"><div><small>Exchange basis</small><p>{terms?.rate.description ?? 'Loading exact terms…'}</p></div><div><small>Confirmations</small><p>{terms ? `${terms.source.confirmations} Zcash · ${terms.destination.confirmations} Base` : 'Loading…'}</p></div><div><small>Provider model</small><p>Trusted testnet liquidity provider · manual approval</p></div></div>
        <details><summary>Custody, late-payment and refund limits</summary><p>{terms?.custody}</p><p>{terms?.refunds}</p></details>
        {!active && <button className="primary-button request-button" disabled={!capabilities || busy || !session.authenticated} onClick={() => void create()}>{busy ? 'Working…' : session.authenticated ? translate(locale, 'requestReview') : 'Sign in to request review'}<ArrowRight size={17}/></button>}
        <p className="fine-print">Creating a request allocates no address, moves no funds, and gives the assistant no transaction authority.</p>
      </section>
      {active && <RequestCard request={active} onRefresh={() => void refresh()}/>}<AgentPanel capabilities={capabilities} request={active}/>
      <footer className="footer"><span>Original Zecathon testnet application</span><span>English UI · voice disabled pending privacy review</span></footer>
    </main></div>;
}
