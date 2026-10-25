import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Bot, Check, CheckCircle2, CircleAlert, Clock3, ExternalLink,
  Fingerprint, KeyRound, Link2, LockKeyhole, LogOut, MicOff, RefreshCw, Send, ShieldCheck, WalletCards,
} from 'lucide-react';
import {
  createOrderRequest, getCapabilities, getOrderRequest, getPrivateReceipt, getSession, issueDestinationChallenge, listOrderRequests, loginWithPasskey,
  logout, registerPasskey, sendAgentMessage, verifyDestinationChallenge, type AgentFactCard, type AgentReply, type PrivateReceipt,
  type PublicCapabilities, type PublicOrderRequest, type UserSession, type WalletReadinessIntent,
} from './lib/order-api.ts';
import { voiceAvailability } from './lib/voice.ts';
import { localeDirection, localeMetadata, resolveLocale, translate, translateOrderStatus, type SupportedLocale } from './lib/i18n.ts';
import {
  inspectBaseReadOnlyProvider, inspectZcashReadOnlyAdapter, requestDestinationControlSignature, validateManualBaseRecipient,
  type WalletChoice, type WalletReadiness,
} from './lib/wallet-readiness.ts';

function navigate(path: string): void { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function short(value: string): string { return `${value.slice(0, 8)}…${value.slice(-6)}`; }
function label(value: string): string { return value.split('_').map(word => word[0] + word.slice(1).toLowerCase()).join(' '); }

const journey = ['Select route', 'Enter amount', 'Configure wallets', 'Review terms', 'Request', 'Payment', 'Tracking', 'Receipt'];
const finalStatuses = new Set<PublicOrderRequest['status']>(['COMPLETED', 'FAILED', 'REFUNDED', 'EXPIRED', 'CANCELLED']);
const trackingStage: Record<PublicOrderRequest['status'], number> = {
  AWAITING_OPERATOR: 4, ACCEPTED: 5, PAYMENT_READY: 5, SOURCE_DETECTED: 6, SOURCE_CONFIRMED: 6,
  PAYOUT_AWAITING_APPROVAL: 6, PAYOUT_SUBMITTED: 6, COMPLETED: 7, FAILED: 6, REFUND_PENDING: 6,
  REFUNDED: 7, UNRESOLVED: 6, EXPIRED: 4, CANCELLED: 4,
};

function JourneyRail({ current }: { current: number }) {
  return <nav className="journey-rail" aria-label="Swap journey"><ol>{journey.map((item, index) => <li className={index < current ? 'complete' : index === current ? 'current' : ''} key={item} aria-current={index === current ? 'step' : undefined}><span>{index < current ? <Check size={13}/> : index + 1}</span><small>{item}</small></li>)}</ol></nav>;
}

function ReceiptView({ receipt }: { receipt: PrivateReceipt }) {
  return <article className="receipt" aria-label="Verified private receipt"><div className="receipt-mark"><CheckCircle2/><div><span>Independently verified</span><strong>Settlement receipt</strong></div></div><dl>
    <div><dt>Receipt</dt><dd><code>{receipt.receiptId}</code></dd></div><div><dt>Verified route</dt><dd>{receipt.verifiedSourceAmount} TAZ → {receipt.verifiedDestinationAmount} USDC</dd></div>
    <div><dt>Source settled</dt><dd>{new Date(receipt.sourceSettlementTimestamp).toLocaleString()}</dd></div><div><dt>Destination settled</dt><dd>{new Date(receipt.destinationSettlementTimestamp).toLocaleString()}</dd></div>
    <div><dt>Source transaction</dt><dd><code>{receipt.sourceTransactionId}</code></dd></div><div><dt>Destination transaction</dt><dd><code>{receipt.destinationTransactionHash}</code></dd></div>
  </dl><p>{receipt.printableNotice}</p></article>;
}

function RequestCard({ request, onRefresh, locale }: { request: PublicOrderRequest; onRefresh: () => void; locale: SupportedLocale }) {
  const [receipt, setReceipt] = useState<PrivateReceipt | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  async function loadReceipt() {
    const receiptId = request.order?.finalReceiptId; if (!receiptId) return;
    setReceiptBusy(true); setReceiptError(null);
    try { setReceipt(await getPrivateReceipt(receiptId)); } catch (caught) { setReceiptError(caught instanceof Error ? caught.message : 'Receipt unavailable.'); } finally { setReceiptBusy(false); }
  }
  return <section className="panel request-card" aria-live="polite"><div className="panel-top"><div><span className="kicker">Private request</span><h2>Operator-tracked settlement</h2></div><span className={`status-chip status-${request.status.toLowerCase()}`}>{translateOrderStatus(locale, request.status)}</span></div>
    <div className="request-id"><span>Request ID</span><code>{request.id}</code><button className="icon-button" onClick={onRefresh} aria-label="Refresh genuine backend status"><RefreshCw size={16}/></button></div>
    <div className={request.destinationBinding.walletControlVerification === 'unverified' ? 'inline-warning' : 'wallet-result ready'}><ShieldCheck size={17}/><span>{request.destinationBinding.walletControlVerification === 'verified-erc1271' ? 'Destination control verified by ERC-1271; checkpoint revalidation is required.' : request.destinationBinding.walletControlVerification === 'verified-eoa' ? 'Destination control verified by EIP-712 signer recovery.' : 'Destination is unverified and cannot be accepted for settlement.'}</span></div>
    <div className="status-summary"><div><small>Created</small><strong>{new Date(request.createdAt).toLocaleString(locale)}</strong></div><div><small>Route</small><strong>0.01 TAZ → 1 test USDC</strong></div><div><small>Status source</small><strong>Authenticated backend</strong></div></div>
    {request.paymentInstructions ? <div className="payment-instructions"><span className="live-flag">Operator accepted · allocation verified</span><strong>Shielded testnet payment receiver</strong><code>{request.paymentInstructions.receiver}</code><p>Send exactly 0.01 TAZ before {new Date(request.paymentInstructions.expiresAt).toLocaleString()}. Use Ironwood shielded funds only. This site does not sign or broadcast.</p></div> : <div className="waiting"><Clock3 size={18}/><div><strong>No payment address published</strong><p>Do not send funds. Instructions appear only after operator acceptance and a durable, independently validated allocation.</p></div></div>}
    {request.order?.resolutionReason && <div className="inline-warning"><CircleAlert size={17}/><span>{request.order.resolutionReason}</span></div>}
    {request.timeline?.length ? <details><summary>Backend event timeline</summary><ol className="event-timeline">{request.timeline.map((event, index) => <li key={`${event.at}-${index}`}><strong>{label(event.type)}</strong><small>{new Date(event.at).toLocaleString(locale)} · {label(event.actor)}</small></li>)}</ol></details> : null}
    {request.status === 'COMPLETED' && request.order?.finalReceiptId ? <div className="receipt-action"><button className="primary-button" disabled={receiptBusy} onClick={() => void loadReceipt()}>{receiptBusy ? 'Loading verified receipt…' : 'Open verified receipt'}</button></div> : null}
    {receiptError && <div className="inline-warning" role="alert"><CircleAlert size={17}/>{receiptError}</div>}{receipt && <ReceiptView receipt={receipt}/>}
  </section>;
}

type IdentityProps = { session: UserSession; busy: boolean; onRegister: (name: string) => void; onLogin: () => void; onAdd: () => void; onLogout: () => void };
function IdentityPanel({ session, busy, onRegister, onLogin, onAdd, onLogout }: IdentityProps) {
  const [name, setName] = useState('');
  if (session.authenticated) return <section className="identity-panel signed-in"><div><span className="kicker"><Fingerprint size={14}/> Passkey session</span><p><strong>{session.user?.displayName}</strong> · {session.user?.passkeyCount} passkey{session.user?.passkeyCount === 1 ? '' : 's'}</p><small>Required for owner-scoped requests, tracking, and private receipts.</small></div><div className="identity-actions"><button className="text-button" disabled={busy} onClick={onAdd}>Add passkey</button><button className="text-button" disabled={busy} onClick={onLogout}><LogOut size={15}/> Sign out</button></div></section>;
  return <section className="identity-panel" id="identity"><div className="identity-copy"><span className="kicker"><KeyRound size={14}/> Private order boundary</span><h3>Sign in only when you are ready to request.</h3><p>Browsing, wallet checks, and route explanations stay public. A passkey is required before creating or tracking a private order.</p></div><div className="identity-form"><label><span>Private account label</span><input value={name} maxLength={80} autoComplete="name" onChange={event => setName(event.target.value)} placeholder="Private account label"/></label><button className="primary-button" disabled={busy || !name.trim()} onClick={() => onRegister(name)}>Create with passkey</button><button className="subtle-button" disabled={busy} onClick={onLogin}>Sign in with passkey</button></div></section>;
}

function History({ requests, locale, identity }: { requests: PublicOrderRequest[]; locale: SupportedLocale; identity: IdentityProps }) {
  return <div className="page" lang={locale} dir={localeDirection(locale)}><main className="main compact-page" id="main"><div className="page-nav"><button className="text-button" onClick={() => navigate('/')}><ArrowLeft size={15}/> Back to route</button><span className="mode">Private order ledger</span></div><div className="eyebrow"><span className="eyebrow-bar"/> Authenticated history</div><h1 className="history-title">Your request ledger.</h1><p className="lead">Only genuine backend records associated with the current passkey account appear here.</p>
    {!identity.session.authenticated ? <IdentityPanel {...identity}/> : <><IdentityPanel {...identity}/><section className="panel history-table">{requests.length ? requests.map(request => <button className="history-row" key={request.id} onClick={() => navigate('/')}><div><strong>{short(request.id)}</strong><small>0.01 TAZ → 1 test USDC</small></div><div><small>Created</small><strong>{new Date(request.createdAt).toLocaleString(locale)}</strong></div><span className={`status-chip status-${request.status.toLowerCase()}`}>{translateOrderStatus(locale, request.status)}</span></button>) : <div className="empty-state"><Clock3/><strong>No private requests yet</strong><p>Confirm a destination and submit the fixed test route when you are ready for operator review.</p></div>}</section></>}
  </main></div>;
}

function AgentPanel({ capabilities, locale }: { capabilities: PublicCapabilities | null; locale: 'en' | 'fr' | 'ar' }) {
  const [message, setMessage] = useState('');
  const [conversation, setConversation] = useState<Array<{ role: 'user' | 'assistant'; text: string; factCards?: AgentFactCard[] }>>([{ role: 'assistant', text: translate(locale, 'agentGreeting') }]);
  const [working, setWorking] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); if (!message.trim()) return; const input = message.trim(); setMessage(''); setWorking(true); setConversation(items => [...items, { role: 'user', text: input }]); try { const reply: AgentReply = await sendAgentMessage(input, locale); setConversation(items => [...items, { role: 'assistant', text: reply.text, ...(reply.factCards ? { factCards: reply.factCards } : {}) }]); } catch (caught) { setConversation(items => [...items, { role: 'assistant', text: caught instanceof Error ? caught.message : 'Assistant unavailable.' }]); } finally { setWorking(false); } }
  return <aside className="agent-panel"><div className="panel-top"><div><span className="kicker"><Bot size={14}/> Route desk</span><h2>Ask before you move.</h2></div><span className="small-chip muted">{capabilities?.agent.mode === 'model-backed' ? 'Model backed' : 'Limited mode'} · no authority</span></div><div className="conversation" aria-live="polite">{conversation.slice(-5).map((item, index) => <div className="agent-message" key={`${item.text}-${index}`}><p className={item.role === 'assistant' ? 'agent-answer' : 'agent-prompt'}>{item.text}</p>{item.factCards?.map(card => <aside className="agent-fact-card" key={card.routeId}><strong>Verified route facts</strong><span>{card.source.amount} {card.source.asset} on {card.source.network} → {card.destination.amount} test {card.destination.asset} on {card.destination.network}</span><span>{card.pricing.description}</span><small>No live quote · no order creation · no payment authority</small></aside>)}</div>)}</div><form className="agent-form" onSubmit={event => void submit(event)}><label><span className="sr-only">Ask the route assistant</span><input value={message} disabled={working} onChange={event => setMessage(event.target.value)} maxLength={2000} placeholder="Ask about privacy, custody, or the route"/></label><button className="icon-button" disabled={working} aria-label="Send message"><Send size={17}/></button></form><div className="voice-disabled"><MicOff size={15}/><span>{voiceAvailability.reason}</span></div></aside>;
}

function WalletOption({ selected, title, body, onClick }: { selected: boolean; title: string; body: string; onClick: () => void }) {
  return <button type="button" className={`wallet-option ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={onClick}><span className="wallet-option-mark">{selected ? <Check size={14}/> : null}</span><span><strong>{title}</strong><small>{body}</small></span></button>;
}

export default function App() {
  const locale = resolveLocale(navigator.language);
  const [route, setRoute] = useState(window.location.pathname);
  const [capabilities, setCapabilities] = useState<PublicCapabilities | null>(null);
  const [session, setSession] = useState<UserSession>({ authenticated: false });
  const [requests, setRequests] = useState<PublicOrderRequest[]>([]);
  const [amount, setAmount] = useState('0.01');
  const [sourceChoice, setSourceChoice] = useState<WalletChoice>('unselected');
  const [destinationChoice, setDestinationChoice] = useState<WalletChoice>('unselected');
  const [sourceCheck, setSourceCheck] = useState<WalletReadiness | null>(null);
  const [destinationCheck, setDestinationCheck] = useState<WalletReadiness | null>(null);
  const [manualRecipient, setManualRecipient] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [destinationConfirmed, setDestinationConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { const handler = () => setRoute(window.location.pathname); window.addEventListener('popstate', handler); return () => window.removeEventListener('popstate', handler); }, []);
  useEffect(() => {
    const provider = window.ethereum; if (!provider?.on) return;
    const invalidate = () => { setDestinationCheck({ ready:false, code:'UNAVAILABLE', message:'Wallet account, network, or connection changed. Check the destination again.' }); setDestinationConfirmed(false); };
    provider.on('accountsChanged', invalidate); provider.on('chainChanged', invalidate); provider.on('disconnect', invalidate);
    return () => { provider.removeListener?.('accountsChanged', invalidate); provider.removeListener?.('chainChanged', invalidate); provider.removeListener?.('disconnect', invalidate); };
  }, []);
  useEffect(() => { void Promise.all([getCapabilities(), getSession()]).then(async ([next, identity]) => { setCapabilities(next); setSession(identity); setRequests(identity.authenticated ? await listOrderRequests() : []); }).catch(caught => setError(caught instanceof Error ? caught.message : 'Service unavailable')); }, []);
  const active = useMemo(() => requests.find(item => !finalStatuses.has(item.status)), [requests]);
  const latestCompleted = useMemo(() => requests.find(item => item.status === 'COMPLETED'), [requests]);
  const validAmount = amount === '0.01';
  const sourceReady = sourceChoice === 'external' || (sourceChoice === 'connected-read-only' && sourceCheck?.ready === true);
  const manualCheck = destinationChoice === 'external' ? validateManualBaseRecipient(manualRecipient) : null;
  const destinationReady = destinationChoice === 'connected-read-only' ? destinationCheck?.ready === true : manualCheck?.ready === true;
  const recipient = destinationChoice === 'connected-read-only' ? destinationCheck?.account : manualCheck?.account;
  const currentStep = active ? trackingStage[active.status] : latestCompleted ? 7 : !validAmount ? 1 : !sourceReady || !destinationReady ? 2 : !termsAccepted || !destinationConfirmed ? 3 : 4;

  async function reloadIdentity() { const identity = await getSession(); setSession(identity); setRequests(identity.authenticated ? await listOrderRequests() : []); }
  async function register(name: string) { setBusy(true); setError(null); try { await registerPasskey(name, 'Primary passkey'); await reloadIdentity(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Passkey registration failed'); } finally { setBusy(false); } }
  async function login() { setBusy(true); setError(null); try { await loginWithPasskey(); await reloadIdentity(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Passkey login failed'); } finally { setBusy(false); } }
  async function addPasskey() { setBusy(true); setError(null); try { await registerPasskey(session.user?.displayName ?? 'Zecathon account', `Additional passkey ${session.user?.passkeyCount ? session.user.passkeyCount + 1 : 2}`, true); await reloadIdentity(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Passkey registration failed'); } finally { setBusy(false); } }
  async function signOut() { setBusy(true); setError(null); try { await logout(); await reloadIdentity(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Logout failed'); } finally { setBusy(false); } }
  async function refresh() { setBusy(true); setError(null); try { setRequests(await listOrderRequests()); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Refresh failed'); } finally { setBusy(false); } }
  async function checkZcash() { setSourceChoice('connected-read-only'); setSourceCheck({ ready: false, code: 'UNAVAILABLE', message: 'Checking read-only capabilities…' }); setSourceCheck(await inspectZcashReadOnlyAdapter(window.zecathonZcashReadOnly)); }
  async function checkBase() { setDestinationChoice('connected-read-only'); setDestinationCheck({ ready: false, code: 'UNAVAILABLE', message: 'Checking chain and existing authorization…' }); setDestinationCheck(await inspectBaseReadOnlyProvider(window.ethereum)); }
  async function create() {
    if (!recipient || !sourceReady || !destinationReady || !termsAccepted || !destinationConfirmed || !capabilities) return;
    const intent: WalletReadinessIntent = { routeId: 'zcash-testnet-to-base-sepolia-fixed', amountZatoshis: '1000000', termsAccepted: true, source: { mode: sourceChoice === 'external' ? 'external' : 'connected-read-only', network: 'zcash-testnet', pool: 'ironwood' }, destination: { mode: destinationChoice === 'external' ? 'manual' : 'connected-read-only', network: 'base-sepolia', chainId: 84532, contract: capabilities.route.destination.contract, address: recipient }, destinationConsent: { version: 'base-destination-intent-v1', statement: 'I confirm this exact Base Sepolia address is the intended USDC recipient. This records my intent and does not prove that I control the wallet.', confirmed: true } };
    setBusy(true); setError(null); try {
      const request = await createOrderRequest(intent); const challenge = await issueDestinationChallenge(request.id);
      if (challenge.recipient.toLowerCase() !== recipient.toLowerCase()) throw new Error('Server challenge recipient does not match the reviewed destination.');
      const signature = await requestDestinationControlSignature(window.ethereum, recipient, challenge.typedData);
      await verifyDestinationChallenge(challenge.challengeId, signature); const verified = await getOrderRequest(request.id);
      setRequests(items => [verified, ...items.filter(item => item.id !== verified.id)]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Destination verification failed'); } finally { setBusy(false); }
  }

  const identity: IdentityProps = { session, busy, onRegister: name => void register(name), onLogin: () => void login(), onAdd: () => void addPasskey(), onLogout: () => void signOut() };
  if (route === '/history') return <History requests={requests} locale={locale} identity={identity}/>;
  const terms = capabilities?.route;
  const requestReady = Boolean(session.authenticated && validAmount && sourceReady && destinationReady && termsAccepted && destinationConfirmed && capabilities?.orderCreation.enabled);

  return <div className="page" lang={locale} dir={localeDirection(locale)}><a className="skip-link" href="#main">Skip to swap</a><header className="header"><button className="brand brand-button" onClick={() => navigate('/')}><span className="brand-symbol">Z</span><span>ZECATHON <small>Privacy routes</small></span></button><div className="header-side"><button className="text-button desktop-action" onClick={() => navigate('/history')}>Private history</button><span className="network-lock"><span/> Testnet only</span></div></header><JourneyRail current={currentStep}/>
    <main className="main" id="main"><section className="hero"><div><div className="eyebrow"><span className="eyebrow-bar"/> Public route explorer</div><h1>Move value.<br/><em>Keep the source private.</em></h1><p className="lead">Explore the exact test route without an account. Configure read-only wallet readiness, understand custody, then use a passkey only at the private order boundary. Shielding limits public-chain disclosure; it does not hide account, wallet-provider, RPC, or trusted-LP metadata.</p></div><aside className="hero-proof"><Fingerprint/><strong>No keys cross this boundary.</strong><span>No seed phrases, private keys, transaction signing, broadcasts, balance reads, or invented quotes. One explicit destination-control signature is required later.</span></aside></section>{error && <div className="inline-warning global-error" role="alert"><CircleAlert size={17}/>{error}</div>}
      <div className="swap-layout"><div className="swap-column">
        <section className="flow-section" aria-labelledby="route-heading"><div className="section-number">01</div><div className="section-content"><span className="kicker">Route</span><h2 id="route-heading">Choose a supported path</h2><p className="section-intro">One route is currently registered. It is a fixed integration test, not a market or liquidity quote.</p><article className="route-card selected"><div className="route-card-top"><span className="fixed-flag">Fixed test route</span><span className="availability">Available to explore</span></div><div className="asset-route"><div><span className="asset-mark zec">Z</span><p><strong>Zcash testnet</strong><small>TAZ · Ironwood shielded</small></p></div><ArrowRight/><div><span className="asset-mark base">B</span><p><strong>Base Sepolia</strong><small>test USDC · chain 84532</small></p></div></div><p className="route-disclosure">Trusted testnet liquidity provider · operator-approved settlement · no live market price</p></article></div></section>
        <section className="flow-section" aria-labelledby="amount-heading"><div className="section-number">02</div><div className="section-content"><span className="kicker">Amount</span><h2 id="amount-heading">Enter the source amount</h2><div className={`amount-field ${validAmount ? '' : 'invalid'}`}><label htmlFor="source-amount">You send</label><div><input id="source-amount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} aria-describedby="amount-help"/><span>TAZ</span></div><small id="amount-help">Only exactly 0.01 TAZ (1,000,000 zatoshis) is supported in this test.</small></div><div className="amount-output"><span>You receive under fixed test terms</span><strong>{terms?.destination.amount ?? '1'} test USDC</strong><small>Network fees are not quoted or invented.</small></div></div></section>
        <section className="flow-section" aria-labelledby="wallet-heading"><div className="section-number">03</div><div className="section-content"><span className="kicker">Wallet readiness</span><h2 id="wallet-heading">Configure both ends</h2><p className="section-intro">Checks are read-only. The application never requests transaction signing, wallet unlock, seed words, or private keys.</p><div className="wallet-grid"><div className="wallet-group"><div className="wallet-heading"><span className="asset-mark zec">Z</span><div><strong>Source wallet</strong><small>Zcash testnet · Ironwood only</small></div></div><WalletOption selected={sourceChoice === 'connected-read-only'} title="Check browser wallet" body="Requires the reviewed Zecathon read-only adapter." onClick={() => void checkZcash()}/><WalletOption selected={sourceChoice === 'external'} title="Use an external Zcash wallet" body="Pay manually only after verified instructions appear." onClick={() => { setSourceChoice('external'); setSourceCheck({ ready: true, code: 'READY', message: 'External wallet selected. Network and Ironwood funding remain your responsibility.' }); }}/>{sourceCheck && <div className={`wallet-result ${sourceCheck.ready ? 'ready' : 'blocked'}`}><span/>{sourceCheck.message}</div>}</div>
          <div className="wallet-group"><div className="wallet-heading"><span className="asset-mark base">B</span><div><strong>Receiving wallet</strong><small>Base Sepolia · read-only check, explicit proof later</small></div></div><WalletOption selected={destinationChoice === 'connected-read-only'} title="Check connected Base wallet" body="Reads chain ID and already-authorized accounts only." onClick={() => void checkBase()}/><WalletOption selected={destinationChoice === 'external'} title="Provide a receiving address" body="Validated locally and encrypted when confirmed." onClick={() => setDestinationChoice('external')}/>{destinationChoice === 'external' && <label className="recipient-field"><span>Base Sepolia address</span><input value={manualRecipient} onChange={event => { setManualRecipient(event.target.value); setDestinationConfirmed(false); }} placeholder="0x…" autoComplete="off" spellCheck={false}/><small className={manualCheck?.ready ? 'success-text' : ''}>{manualCheck?.message}</small></label>}{destinationChoice === 'connected-read-only' && destinationCheck && <div className={`wallet-result ${destinationCheck.ready ? 'ready' : 'blocked'}`}><span/>{destinationCheck.message}{destinationCheck.account ? ` ${short(destinationCheck.account)}` : ''}</div>}</div></div>
          <div className="binding-blocker"><LockKeyhole/><div><strong>Destination is unverified until you sign</strong><p>The final button explicitly requests wallet access and an EIP-712 destination-control signature bound to your account, session, exact intent, recipient, Base Sepolia, origin, purpose, nonce, and expiry. It never authorizes payment or payout.</p></div></div></div></section>
        <section className="flow-section" aria-labelledby="review-heading"><div className="section-number">04</div><div className="section-content"><span className="kicker">Review</span><h2 id="review-heading">Know the exact terms</h2><div className="review-grid"><dl><div><dt>Pricing</dt><dd>{terms?.rate.description ?? 'Fixed test rate; not a market quote.'}</dd></div><div><dt>Confirmations</dt><dd>{terms ? `${terms.source.confirmations} Zcash · ${terms.destination.confirmations} Base` : '10 Zcash · 3 Base'}</dd></div><div><dt>Custody</dt><dd>{terms?.custody ?? 'Trusted provider custody during settlement.'}</dd></div><div><dt>Refunds</dt><dd>{terms?.refunds ?? 'Manual review; no automatic refund guarantee.'}</dd></div></dl><label className="terms-check"><input type="checkbox" checked={destinationConfirmed} disabled={!recipient || !destinationReady} onChange={event => setDestinationConfirmed(event.target.checked)}/><span><strong>I confirm this exact Base Sepolia address is the intended USDC recipient.</strong><small>{recipient ? short(recipient) : 'Configure a valid receiving address first.'} · This records intent; it does not prove wallet control.</small></span></label><label className="terms-check"><input type="checkbox" checked={termsAccepted} onChange={event => setTermsAccepted(event.target.checked)}/><span><strong>I understand these are fixed test terms.</strong><small>No payment address exists at request time. Late payments and refunds require manual review.</small></span></label></div></div></section>
        <section className="flow-section request-section" aria-labelledby="request-heading"><div className="section-number">05</div><div className="section-content"><span className="kicker">Private request</span><h2 id="request-heading">Verify destination control</h2><IdentityPanel {...identity}/><div className="request-gate"><div><strong>{capabilities?.orderCreation.enabled ? 'Signature required for operator review' : 'Checking secure binding support'}</strong><p>{capabilities?.orderCreation.enabled ? 'Your click requests wallet permission, then a single destination-control signature. Rejection, disconnect, account switching, and network changes fail closed.' : 'Checking durable destination-binding support…'}</p></div><button className="primary-button" disabled={!requestReady || busy} onClick={() => void create()}>{busy ? 'Waiting for wallet…' : !session.authenticated ? 'Sign in before requesting' : capabilities?.orderCreation.enabled ? 'Verify destination & request review' : 'Destination binding unavailable'}<ArrowRight size={17}/></button></div><p className="fine-print">This signature proves destination control only. It is not a source-payment signature, payout approval, transaction, or spending authorization.</p></div></section>
      </div><aside className="context-column"><section className="context-card"><span className="kicker">Safety contract</span><ul><li><ShieldCheck/> Shielded Ironwood source only</li><li><WalletCards/> Testnet wallets only</li><li><LockKeyhole/> No signing or broadcasting</li><li><Link2/> Backend evidence, not promises</li></ul></section><AgentPanel capabilities={capabilities} locale={locale}/></aside></div>
      {active && <><JourneyRail current={trackingStage[active.status]}/><RequestCard request={active} onRefresh={() => void refresh()} locale={locale}/></>}{!active && latestCompleted && <RequestCard request={latestCompleted} onRefresh={() => void refresh()} locale={locale}/>}<footer className="footer"><span>Zecathon privacy routes · testnet research application</span><span>{locale.toUpperCase()} · {localeMetadata[locale].translationReview.replaceAll('-', ' ')} · <a href="/history" onClick={event => { event.preventDefault(); navigate('/history'); }}>private history <ExternalLink size={11}/></a></span></footer>
    </main></div>;
}
