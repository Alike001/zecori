import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Bot, Check, CheckCircle2, CircleAlert, Clock3, Copy, ExternalLink,
  Fingerprint, KeyRound, Link2, LockKeyhole, LogOut, Menu, Mic, RefreshCw, Send, ShieldCheck, Square, Volume2, WalletCards, X,
} from 'lucide-react';
import {
  createOrderRequest, getCapabilities, getOrderRequest, getPrivateReceipt, getSession, issueDestinationChallenge, listOrderRequests, loginWithPasskey,
  linkPrivy, loginWithPrivy, logout, registerPasskey, sendAgentMessage, synthesizeVoice, transcribeVoice, verifyDestinationChallenge, type AgentFactCard, type AgentReply, type PrivateReceipt,
  type PublicCapabilities, type PublicOrderRequest, type UserSession, type WalletReadinessIntent,
} from './lib/order-api.ts';
import { reviewVoiceTranscript, VOICE_CAPTURE_LIMITS } from './lib/voice.ts';
import { localeDirection, localeMetadata, publicResolutionReason, resolveLocale, translate, translateOrderGuidance, translateOrderStatus, type SupportedLocale } from './lib/i18n.ts';
import {
  inspectBaseReadOnlyProvider, requestDestinationControlSignature, sameEvmAddress, subscribeInjectedWalletProviders, validateManualBaseRecipient,
  type InjectedWalletProvider, type WalletChoice, type WalletReadiness,
} from './lib/wallet-readiness.ts';
import { assertLocalDestinationSigner } from './lib/destination-verification.ts';
import { ROUTE_CAPABILITIES } from './lib/route-capabilities.ts';
import { paymentInstructionsAreActionable } from './lib/order-presentation.ts';
import {
  detectOfficialNoirWallet, expireNoirReadiness, inspectNoirWallet, subscribeToNoirAccountChanges,
  type NoirWalletReadiness,
} from './lib/noir-wallet-readonly.ts';
import { prepareNoirPaymentConfirmation } from './lib/noir-payment-confirmation.ts';
import { copyExactReceiver, preparePaymentReadyInstructions, recipientFromClipboard } from './lib/payment-ready.ts';
import { paymentCountdown } from './lib/payment-countdown.ts';
import type { NoirWalletProvider } from '@noir-wallet/sdk';
import { QRCodeSVG } from 'qrcode.react';
import { usePrivyBridge } from './lib/privy-bridge.tsx';
import { AccountSurface, AssistantSurface, DocsSite, InboxSurface, NotFound, ProductHeader, ProductPage } from './ProductSurfaces.tsx';
import { BrandWordmark, ThemeToggle } from './Brand.tsx';

function navigate(path: string): void { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function short(value: string): string { return `${value.slice(0, 8)}…${value.slice(-6)}`; }
function label(value: string): string { return value.split('_').map(word => word[0] + word.slice(1).toLowerCase()).join(' '); }
function requestIdFromRoute(route: string): string | undefined {
  if (!route.startsWith('/swap/')) return undefined;
  try { return decodeURIComponent(route.slice('/swap/'.length)); } catch { return undefined; }
}

const journey = ['Availability', 'Wallet setup', 'Review', 'Activity'];
const finalStatuses = new Set<PublicOrderRequest['status']>(['COMPLETED', 'FAILED', 'REFUNDED', 'EXPIRED', 'CANCELLED']);
const trackingStage: Record<PublicOrderRequest['status'], number> = {
  AWAITING_OPERATOR: 3, ACCEPTED: 3, PAYMENT_READY: 3, SOURCE_DETECTED: 3, SOURCE_CONFIRMED: 3,
  PAYOUT_AWAITING_APPROVAL: 3, PAYOUT_SUBMITTED: 3, COMPLETED: 3, FAILED: 3, REFUND_PENDING: 3,
  REFUNDED: 3, UNRESOLVED: 3, EXPIRED: 3, CANCELLED: 3,
};

function JourneyRail({ current }: { current: number }) {
  return <nav className="journey-rail" aria-label="Swap journey" data-current={`Step ${current + 1} of ${journey.length} · ${journey[current]}`}><ol>{journey.map((item, index) => <li className={index < current ? 'complete' : index === current ? 'current' : ''} key={item} aria-current={index === current ? 'step' : undefined}><span>{index < current ? <Check size={13}/> : index + 1}</span><small>{item}</small></li>)}</ol></nav>;
}

function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [preview, setPreview] = useState<'route' | 'verify' | 'receipt'>('route');
  const close = () => setMenuOpen(false);
  return <div className="landing-page"><a className="skip-link" href="#main">Skip to content</a>
    <header className="public-header"><button className="brand brand-button" onClick={() => navigate('/')} aria-label="Zecori home"><BrandWordmark/></button>
      <button className="menu-toggle" aria-expanded={menuOpen} aria-controls="public-navigation" onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X/> : <Menu/>}<span className="sr-only">Toggle navigation</span></button>
      <nav id="public-navigation" className={menuOpen ? 'public-nav open' : 'public-nav'} aria-label="Main navigation"><a href="#how" onClick={close}>How it works</a><a href="#safety" onClick={close}>Privacy</a><a href="/help" onClick={event => { event.preventDefault(); close(); navigate('/help'); }}>Help</a><a href="/docs/judge-walkthrough" onClick={event => { event.preventDefault(); close(); navigate('/docs/judge-walkthrough'); }}>Judge guide</a><ThemeToggle/><button className="nav-cta" onClick={() => navigate('/swap')}>Open app <ArrowRight size={15}/></button></nav>
    </header>
    <main id="main">
      <section className="landing-hero"><div className="hero-copy"><span className="availability-line"><span/> One implemented testnet route · operator readiness required</span><h1>Private origin.<br/><em>Verified arrival.</em></h1><p>Explore the guarded 0.01 shielded TAZ to 1 test USDC flow. Request creation opens only when the deployment operator attests the current provider and testnet path; no linked settlement is claimed yet.</p><div className="hero-actions"><button className="primary-button" onClick={() => navigate('/swap')}>Open app <ArrowRight size={17}/></button><a href="/docs/judge-walkthrough" onClick={event => { event.preventDefault(); navigate('/docs/judge-walkthrough'); }}>What judges can test now</a></div><p className="hero-caveat">Testnet only · fixed test terms, not a quote · experimental trusted LP · no automatic payouts</p></div>
        <aside className="route-ticket" aria-label="Implemented route under operator review"><div className="ticket-top"><span>IMPLEMENTED / NOT LIVE</span><small>Testnet</small></div><div className="ticket-leg"><span className="asset-mark zec">Z</span><div><small>Private origin</small><strong>0.01 TAZ</strong><span>Zcash testnet · Ironwood shielded</span></div></div><div className="ticket-line" aria-hidden="true"><span/><svg viewBox="0 0 72 18"><path d="M1 9h51c8 0 8-7 18-7M52 9c8 0 8 7 18 7"/><circle cx="1" cy="9" r="2"/><circle cx="70" cy="2" r="2"/><circle cx="70" cy="16" r="2"/></svg><span/></div><div className="ticket-leg"><span className="asset-mark base">B</span><div><small>Evidence target</small><strong>1 test USDC</strong><span>Base Sepolia · chain 84532</span></div></div><div className="ticket-foot">No market quote. Request creation and payment instructions fail closed until readiness is attested.</div></aside>
      </section>
      <section className="proof-strip" aria-label="Product boundaries"><span><strong>Public first</strong>Browse without an account</span><span><strong>Shielded source</strong>Ironwood pool only</span><span><strong>Human approval</strong>No automatic payout</span><span><strong>Evidence led</strong>Status comes from the backend</span></section>
      <section className="landing-section how-section" id="how"><div className="section-heading"><span className="kicker">How it works</span><h2>A guarded path, not a magic bridge.</h2><p>Each boundary is visible before the next one opens.</p></div><ol className="how-grid"><li><span>01</span><h3>Explore</h3><p>Read the route, privacy limits, custody model, and exact fixed test terms without signing in.</p></li><li><span>02</span><h3>Prove the destination</h3><p>Sign in, configure both ends, review the recipient, then make one purpose-limited EIP-712 proof.</p></li><li><span>03</span><h3>Wait for approval</h3><p>No Zcash receiver appears until an operator accepts the request and validates a dedicated allocation.</p></li><li><span>04</span><h3>Track evidence</h3><p>Follow genuine lifecycle states. A final receipt appears only after independent checks on both chains.</p></li></ol></section>
      <section className="landing-section routes-section" id="routes"><div className="section-heading"><span className="kicker">Route registry</span><h2>Available means verified.</h2><p>Research ideas never masquerade as usable financial routes.</p></div><div className="capability-list">{ROUTE_CAPABILITIES.map((route, index) => <article className={route.execution.enabled ? 'capability-row enabled' : 'capability-row'} key={route.id}><div className="capability-index">0{index + 1}</div><div><span className={`capability-state ${route.availability}`}>{route.availability.replaceAll('-', ' ')}</span><h3>{route.title}</h3><p>{route.summary}</p></div><div className="capability-route"><strong>{route.source.asset}</strong><span>{route.source.network}</span><ArrowRight size={16}/><strong>{route.destination.asset}</strong><span>{route.destination.network}</span></div><div className="capability-action">{route.id === 'zcash-testnet-to-base-sepolia-fixed' ? <button className="subtle-button" onClick={() => navigate('/swap')}>Inspect readiness</button> : <button className="subtle-button" disabled>Not available</button>}<small>{route.disclosure}</small></div></article>)}</div></section>
      <section className="landing-section product-preview" aria-labelledby="preview-heading"><div className="preview-copy"><span className="kicker">Working product preview</span><h2 id="preview-heading">See the guardrails before you enter.</h2><p>This guided preview mirrors real product states. It does not create an order, connect a wallet, or imply a completed settlement.</p><div className="preview-tabs" role="tablist" aria-label="Product preview states">{(['route', 'verify', 'receipt'] as const).map(item => <button type="button" role="tab" aria-selected={preview === item} key={item} onClick={() => setPreview(item)}>{item === 'route' ? '1 · Route' : item === 'verify' ? '2 · Verify' : '3 · Receipt'}</button>)}</div><button className="text-button preview-link" onClick={() => navigate('/swap')}>Open the interactive route <ArrowRight size={15}/></button></div><div className="preview-window" aria-live="polite"><div className="preview-chrome"><span/><span/><span/><small>zecori / {preview}</small></div>{preview === 'route' && <div className="preview-route"><span className="fixed-flag">Fixed test terms</span><div className="preview-assets"><div><span className="asset-mark zec">Z</span><strong>0.01 TAZ</strong><small>Ironwood shielded</small></div><ArrowRight/><div><span className="asset-mark base">B</span><strong>1 test USDC</strong><small>Base Sepolia</small></div></div><p>One route is executable. No provider quote is being shown.</p></div>}{preview === 'verify' && <div className="preview-verify"><Fingerprint/><span className="kicker">Purpose-limited proof</span><h3>Confirm the exact recipient.</h3><p>The EIP-712 signature proves destination control. It cannot spend tokens, approve payout, or create a payment.</p><div className="preview-address">0x recipient bound to this account</div></div>}{preview === 'receipt' && <div className="preview-receipt"><CheckCircle2/><span className="kicker">Backend evidence only</span><h3>Receipt appears after both checks.</h3><dl><div><dt>Source</dt><dd>independently verified</dd></div><div><dt>Destination</dt><dd>independently verified</dd></div><div><dt>Ownership</dt><dd>private account only</dd></div></dl><small>Illustrative state · not a settlement claim</small></div>}</div></section>
      <section className="landing-section privacy-section" id="safety"><div className="privacy-statement"><span className="kicker">Privacy and custody</span><h2>Shielded in. Transparent out.</h2><p>The source payment uses Zcash’s Ironwood shielded pool. The destination payout is a public Base Sepolia transaction, so its recipient, token amount, and transaction hash are visible on that chain. The experimental trusted LP and authorized verification services also see evidence needed to settle; account, wallet, and RPC providers may observe metadata.</p></div><div className="boundary-grid"><article><Fingerprint/><h3>You keep wallet control</h3><p>Zecori never asks for a seed phrase or private key and never signs or broadcasts a transaction.</p></article><article><LockKeyhole/><h3>The LP holds test funds</h3><p>This is not trustless. The experimental trusted LP temporarily controls received TAZ while a separate operator approves the test-USDC payout.</p></article><article><ShieldCheck/><h3>Recovery stops safely</h3><p>Rejected signatures, wrong networks, expired requests, or uncertain evidence reveal no payment address. Refunds require manual review and are not guaranteed.</p></article></div></section>
      <section className="landing-section roadmap-section" id="roadmap"><div className="section-heading"><span className="kicker">Honest roadmap</span><h2>Working now, expanding only with evidence.</h2><p>Private handles and the in-app inbox are implemented. Payment-by-handle, external alerts, and broader providers remain gated.</p></div><div className="roadmap-list"><article><span>Experimental</span><h3>@handles + private contacts</h3><p>Exact-match discovery and non-paying request intents work with explicit consent. Handles never expose an address or authorize payment.</p></article><article><span>Experimental</span><h3>Event-backed inbox</h3><p>Owner-scoped items derive from committed lifecycle events. External email and push alerts remain disabled.</p></article><article><span>Planned</span><h3>Provider comparisons</h3><p>Only independently sourced quotes with timestamps, limitations, and clear unavailable states.</p></article><article><span>Gated</span><h3>Voice + language expansion</h3><p>Live validation and human review are required before broader speech or translated security copy ships.</p></article></div><button className="text-button" onClick={() => navigate('/docs/roadmap')}>Read the evidence gates <ArrowRight size={15}/></button></section>
      <section className="landing-section faq-section" id="faq"><div className="section-heading"><span className="kicker">Straight answers</span><h2>Before you try it.</h2></div><div className="faq-grid"><article><h3>Is this mainnet?</h3><p>No. The only executable route uses Zcash testnet TAZ and Base Sepolia test USDC.</p></article><article><h3>Do I need an account to look around?</h3><p>No. Sign in is required only when you create a private request, track it, or open a private receipt.</p></article><article><h3>Is the amount a quote?</h3><p>No. 0.01 TAZ → 1 test USDC is a fixed integration-test term, not a price or liquidity promise.</p></article><article><h3>Can Zecori spend from my wallet?</h3><p>No. The destination signature proves control of the receiving address and grants no payment, token, or payout authority.</p></article><article><h3>When should I send TAZ?</h3><p>Only after your private request shows a validated shielded receiver. If there is no receiver, do not pay.</p></article><article><h3>What remains disabled?</h3><p>Mainnet, live quotes, automatic settlement and refunds, Privy login, payment-by-handle, external alerts, and production voice remain unavailable.</p></article></div></section>
      <section className="closing-cta"><span>ONE ROUTE. CLEAR BOUNDARIES.</span><h2>Inspect the exact journey before you sign in.</h2><button className="primary-button" onClick={() => navigate('/swap')}>Explore the test route <ArrowRight size={17}/></button></section>
    </main><footer className="public-footer"><span>Built for Zecathon 2026 · Cross-Chain Track</span><nav><a href="#routes">Route status</a><a href="#safety">Privacy</a><a href="/docs/getting-started" onClick={event => { event.preventDefault(); navigate('/docs/getting-started'); }}>Documentation</a></nav><span>Testnet · experimental trusted LP</span></footer>
  </div>;
}

function ReceiptView({ receipt }: { receipt: PrivateReceipt }) {
  return <article className="receipt" aria-label="Verified private receipt"><div className="receipt-brand"><BrandWordmark context="Verified receipt"/><span>Private evidence record</span></div><div className="receipt-mark"><CheckCircle2/><div><span>Independently verified</span><strong>Settlement receipt</strong></div></div><dl>
    <div><dt>Receipt</dt><dd><code>{receipt.receiptId}</code></dd></div><div><dt>Verified route</dt><dd>{receipt.verifiedSourceAmount} TAZ → {receipt.verifiedDestinationAmount} USDC</dd></div>
    <div><dt>Source settled</dt><dd>{new Date(receipt.sourceSettlementTimestamp).toLocaleString()}</dd></div><div><dt>Destination settled</dt><dd>{new Date(receipt.destinationSettlementTimestamp).toLocaleString()}</dd></div>
    <div><dt>Source transaction</dt><dd><code>{receipt.sourceTransactionId}</code></dd></div><div><dt>Destination transaction</dt><dd><code>{receipt.destinationTransactionHash}</code></dd></div>
  </dl><p>{receipt.printableNotice}</p></article>;
}

function destinationVerificationNeeded(request: PublicOrderRequest): boolean {
  return request.status === 'AWAITING_OPERATOR' && request.destinationBinding.walletControlVerification === 'unverified' && Boolean(request.destinationReview?.recipient);
}
function requestStatusText(request: PublicOrderRequest, locale: SupportedLocale): string {
  return destinationVerificationNeeded(request) ? 'Action needed · verify receiving wallet' : translateOrderStatus(locale, request.status);
}

function RequestCard({ request, onRefresh, onVerify, verificationBusy, verificationError, locale }: { request: PublicOrderRequest; onRefresh: () => void; onVerify: (request: PublicOrderRequest) => void; verificationBusy: boolean; verificationError?: string; locale: SupportedLocale }) {
  const [receipt, setReceipt] = useState<PrivateReceipt | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => setCopyState('idle'), [request.id, request.status, request.paymentInstructions?.receiver]);
  async function loadReceipt() {
    const receiptId = request.order?.finalReceiptId; if (!receiptId) return;
    setReceiptBusy(true); setReceiptError(null);
    try { setReceipt(await getPrivateReceipt(receiptId)); } catch (caught) { setReceiptError(caught instanceof Error ? caught.message : 'Receipt unavailable.'); } finally { setReceiptBusy(false); }
  }
  const guidance = translateOrderGuidance(locale, request.status);
  let paymentInstructions: ReturnType<typeof preparePaymentReadyInstructions> | null = null;
  if (request.paymentInstructions && paymentInstructionsAreActionable(request.status)) {
    try { paymentInstructions = preparePaymentReadyInstructions(request, now); } catch { paymentInstructions = null; }
  }
  const paymentOpen = paymentInstructions !== null;
  const countdown = request.paymentDeadline ? paymentCountdown(request.paymentDeadline, now) : null;
  const paymentExpired = request.status === 'PAYMENT_READY' && countdown?.expired === true;
  let noirConfirmation: ReturnType<typeof prepareNoirPaymentConfirmation> | null = null;
  if (paymentOpen) { try { noirConfirmation = prepareNoirPaymentConfirmation(request, 'shielded', now); } catch { noirConfirmation = null; } }
  async function copyReceiver() {
    if (!paymentInstructions) return;
    setCopyState('idle');
    try { await copyExactReceiver(paymentInstructions.receiver, navigator.clipboard); setCopyState('copied'); }
    catch { setCopyState('error'); }
  }
  return <section className="panel request-card" id="request-tracking" aria-live="polite"><div className="panel-top"><div><span className="kicker">Private request</span><h2>Operator-tracked settlement</h2></div><span className={`status-chip status-${request.status.toLowerCase()}`}>{paymentExpired ? 'Payment expired · recovery' : requestStatusText(request, locale)}</span></div>
    <div className="request-id"><span>Request ID</span><code>{request.id}</code><button className="icon-button" onClick={onRefresh} aria-label="Refresh genuine backend status"><RefreshCw size={16}/></button></div>
    <div className={request.destinationBinding.walletControlVerification === 'unverified' ? 'inline-warning' : 'destination-control-status ready'}><ShieldCheck size={17}/><span>{request.destinationBinding.walletControlVerification === 'verified-erc1271' ? 'Destination control verified by ERC-1271; checkpoint revalidation is required.' : request.destinationBinding.walletControlVerification === 'verified-eoa' ? 'Destination control verified by EIP-712 signer recovery.' : 'Action needed: verify receiving wallet. This request cannot be accepted for settlement yet.'}</span></div>
    {destinationVerificationNeeded(request) && <div className="verification-retry"><div><strong>Verify the reviewed recipient</strong><small><code>{request.destinationReview?.recipient}</code></small></div><button type="button" className="primary-button" disabled={verificationBusy} onClick={() => onVerify(request)}>{verificationBusy ? 'Waiting for wallet…' : 'Verify receiving wallet'}</button></div>}
    {verificationError && <div className="inline-warning" role="alert"><CircleAlert size={17}/><span>{verificationError}</span></div>}
    <div className="status-summary"><div><small>Created</small><strong>{new Date(request.createdAt).toLocaleString(locale)}</strong></div><div><small>Route</small><strong>0.01 TAZ → 1 test USDC</strong></div><div><small>Status source</small><strong>Authenticated backend</strong></div></div>
    {paymentOpen && paymentInstructions ? <div className="payment-instructions">
      <span className="live-flag">PAYMENT_READY · receiver allocation verified</span>
      <div className="payment-countdown" role="timer" aria-label={`Shielded payment time remaining ${countdown?.label ?? ''}`}><span>Shielded payment deadline</span><strong>{countdown?.label}</strong><small>Do not send after this timer reaches zero.</small></div>
      <strong>Use your chosen Zcash wallet only after reviewing every exact term</strong>
      <div className="receiver-panel"><div className="receiver-copy"><span>Exact shielded receiver</span><code data-private-payment-receiver>{paymentInstructions.receiver}</code><button type="button" className="subtle-button" onClick={() => void copyReceiver()}><Copy size={15}/>{copyState === 'copied' ? 'Copied exact receiver' : 'Copy full receiver'}</button>{copyState === 'error' && <small role="alert">Clipboard access failed. Select the full receiver shown above and copy it manually.</small>}</div><div className="receiver-qr"><QRCodeSVG value={paymentInstructions.qrPayload} size={184} level="M" marginSize={4} title="Exact Zcash testnet shielded receiver"/><small>QR encodes the exact receiver only. It does not claim wallet compatibility or include an amount.</small></div></div>
      <dl><div><dt>Source</dt><dd>Exactly {paymentInstructions.sourceAmount} TAZ · Zcash testnet · Ironwood shielded only</dd></div><div><dt>Destination</dt><dd>Exactly 1 test USDC · Base Sepolia · chain {paymentInstructions.destinationChainId} · {paymentInstructions.destinationContract}</dd></div><div><dt>Recipient</dt><dd><code>{paymentInstructions.destinationRecipient}</code></dd></div><div><dt>Order</dt><dd><code>{paymentInstructions.orderId}</code> · immutable fixed terms</dd></div><div><dt>Memo</dt><dd>Send with no memo. A shielded memo is readable by the receiving operator and must never contain a handle, note, identity, or Base address.</dd></div><div><dt>Fees</dt><dd>No fee quote is available; external wallet and network fees are additional</dd></div><div><dt>Payment deadline</dt><dd><time dateTime={paymentInstructions.expiresAt}>{new Date(paymentInstructions.expiresAt).toLocaleString(locale)}</time></dd></div><div><dt>Refunds</dt><dd>{request.terms.refunds}</dd></div></dl>
      <p>Do not send if any term differs from your intent. Do not use transparent funds or an unshielding fallback. The operator can correlate this order, its dedicated shielded receiver and source evidence with the public Base payout. This site does not unlock, sign, broadcast, guarantee payout, or guarantee a refund.</p>
      {noirConfirmation&&<div className="noir-payment-review"><div><span className="kicker">Noir Wallet path remains guarded</span><strong>Review-only shielded request · sending disabled</strong><small>{noirConfirmation.exactAmount} TAZ · dedicated receiver · expires {new Date(noirConfirmation.expiresAt).toLocaleString(locale)}</small></div><code>fundingSource: 'shielded'</code><p>The future request is bound to order <code>{noirConfirmation.orderId}</code>, exact immutable terms, this receiver and expiry. Zecori does not call <code>sendTransaction</code>; use the external-wallet instructions only with a wallet you independently know can make this exact shielded testnet payment.</p></div>}
    </div> : request.paymentInstructions ? <div className={`waiting ${paymentExpired ? 'payment-expired' : ''}`}><LockKeyhole size={18}/><div><strong>{paymentExpired ? 'Payment deadline passed — recovery only' : 'Payment instructions are no longer active'}</strong><p>{paymentExpired ? 'Do not send now and do not create a replacement if you already sent. A late or uncertain payment stays in manual recovery; use the recovery guide below.' : 'Do not send or resend funds. The dedicated receiver remains bound to this private request but is hidden from the actionable view after expiry or any lifecycle advance.'}</p></div></div> : <div className="waiting"><Clock3 size={18}/><div><strong>No payment address published</strong><p>Do not send funds. Instructions appear only after operator acceptance and a durable, independently validated allocation.</p></div></div>}
    <div className="recovery-guidance"><CircleAlert size={18}/><div><strong>{guidance.title}</strong><p>{guidance.body}</p><a href="/docs/order-recovery" onClick={event => { event.preventDefault(); navigate('/docs/order-recovery'); }}>Open recovery guide <ArrowRight size={14}/></a></div></div>
    {request.order?.resolutionReason && <div className="inline-warning"><CircleAlert size={17}/><span>{publicResolutionReason(request.order.resolutionReason)}</span></div>}
    {request.timeline?.length ? <details><summary>Backend event timeline</summary><ol className="event-timeline">{request.timeline.map((event, index) => <li key={`${event.at}-${index}`}><strong>{label(event.type)}</strong><small>{new Date(event.at).toLocaleString(locale)} · {label(event.actor)}</small></li>)}</ol></details> : null}
    {request.status === 'COMPLETED' && request.order?.finalReceiptId ? <div className="receipt-action"><button className="primary-button" disabled={receiptBusy} onClick={() => void loadReceipt()}>{receiptBusy ? 'Loading verified receipt…' : 'Open verified receipt'}</button></div> : null}
    {receiptError && <div className="inline-warning" role="alert"><CircleAlert size={17}/>{receiptError}</div>}{receipt && <ReceiptView receipt={receipt}/>}
  </section>;
}

type IdentityProps = { session: UserSession; busy: boolean; privyEnabled: boolean; privyAuthenticated: boolean; onRegister: (name: string) => void; onLogin: () => void; onPrivy: () => void; onLinkPrivy: () => void; onAdd: () => void; onLogout: () => void };
function IdentityPanel({ session, busy, privyEnabled, privyAuthenticated, onRegister, onLogin, onPrivy, onLinkPrivy, onAdd, onLogout }: IdentityProps) {
  const [name, setName] = useState('');
  if (session.authenticated) return <section className="identity-panel signed-in"><div><span className="kicker"><Fingerprint size={14}/> Secure account session</span><p><strong>{session.user?.displayName}</strong> · {session.user?.passkeyCount ?? 0} passkey{session.user?.passkeyCount === 1 ? '' : 's'}</p><small>This internal account owns private requests; signing in another way never changes settlement ownership.</small></div><div className="identity-actions"><button className="text-button" disabled={busy} onClick={onAdd}>Add passkey</button>{privyEnabled && <button className="text-button" disabled={busy} onClick={privyAuthenticated ? onLinkPrivy : onPrivy}>{privyAuthenticated ? 'Link this Privy login' : 'Connect Privy to link'}</button>}<button className="text-button" disabled={busy} onClick={onLogout}><LogOut size={15}/> Sign out</button></div></section>;
  return <section className="identity-panel" id="identity"><div className="identity-copy"><span className="kicker"><KeyRound size={14}/> Private order boundary</span><h3>Sign in only when you are ready to request.</h3><p>Browsing, wallet checks, and route explanations stay public. Authentication protects private requests, tracking, and receipts.</p>{privyEnabled && <small>Privy email and Google login create no embedded wallet and grant no signing authority.</small>}</div><div className="identity-form"><label><span>Private account label</span><input value={name} maxLength={80} autoComplete="name" onChange={event => setName(event.target.value)} placeholder="Private account label"/></label><button className="primary-button" disabled={busy || !name.trim()} onClick={() => onRegister(name)}>Create with passkey</button><button className="subtle-button" disabled={busy} onClick={onLogin}>Sign in with passkey</button>{privyEnabled && <button className="subtle-button" disabled={busy} onClick={onPrivy}>{privyAuthenticated ? 'Continue with verified Privy login' : 'Continue with email or Google'}</button>}</div></section>;
}

function ServiceNotice({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) return <div className="service-skeleton" role="status" aria-label="Loading current backend capabilities"><span/><span/><span/><small>Checking current route and account availability…</small></div>;
  if (error) return <div className="inline-warning global-error" role="alert"><CircleAlert size={17}/><span><strong>Live service information is unavailable.</strong> {error} No financial action has been enabled.</span></div>;
  return null;
}

function WalletProviderPicker({ providers, selectedId, onSelect }: { providers: InjectedWalletProvider[]; selectedId: string; onSelect: (id: string) => void }) {
  if (!providers.length) return <div className="inline-warning"><CircleAlert size={17}/><span>No injected EIP-1193 wallet was detected. Install or enable the wallet that controls the receiving address.</span></div>;
  if (providers.length === 1) return <small className="provider-selection">Signing provider: {providers[0].name}</small>;
  return <label className="provider-picker"><span>Select the wallet provider used for this proof</span><select value={selectedId} onChange={event => onSelect(event.target.value)}><option value="">Choose wallet…</option>{providers.map(item => <option key={item.id} value={item.id}>{item.name}{item.rdns ? ` · ${item.rdns}` : ''}{item.isMetaMask ? ' · MetaMask' : ''}</option>)}</select><small>Only this explicitly selected provider will receive account, chain, and EIP-712 signing requests.</small></label>;
}

function History({ requests, locale, identity, loading, error, onVerify, verificationBusyId, verificationErrors, providers, selectedProviderId, onSelectProvider }: { requests: PublicOrderRequest[]; locale: SupportedLocale; identity: IdentityProps; loading: boolean; error: string | null; onVerify: (request: PublicOrderRequest) => void; verificationBusyId?: string; verificationErrors: Record<string, string>; providers: InjectedWalletProvider[]; selectedProviderId: string; onSelectProvider: (id: string) => void }) {
  return <ProductPage current="activity" navigate={navigate} locale={locale}><div lang={locale} dir={localeDirection(locale)}><div className="page-nav"><button className="text-button" onClick={() => navigate('/swap')}><ArrowLeft size={15}/> Back to route</button><span className="mode">Private order ledger</span></div><div className="eyebrow"><span className="eyebrow-bar"/> {identity.session.authenticated ? 'Your private activity' : 'Sign-in protected activity'}</div><h1 className="history-title">Your request ledger.</h1><p className="lead">Only genuine backend records associated with the current account appear here.</p><ServiceNotice loading={loading} error={error}/>
    {!identity.session.authenticated ? <IdentityPanel {...identity}/> : <><IdentityPanel {...identity}/>{requests.some(destinationVerificationNeeded)&&<section className="panel verification-provider"><WalletProviderPicker providers={providers} selectedId={selectedProviderId} onSelect={onSelectProvider}/></section>}<section className="panel history-table">{requests.length ? requests.map(request => <article className="history-row" key={request.id}><button type="button" className="history-detail" onClick={() => navigate(`/swap/${encodeURIComponent(request.id)}`)} aria-label={`Open request ${short(request.id)}, ${requestStatusText(request, locale)}`}><div><strong>{short(request.id)}</strong><small>0.01 TAZ → 1 test USDC</small></div><div><small>Created</small><strong>{new Date(request.createdAt).toLocaleString(locale)}</strong></div><span className={`status-chip status-${request.status.toLowerCase()}`}>{requestStatusText(request, locale)}</span><span className="history-open">Track / recover <ArrowRight size={14}/></span></button>{destinationVerificationNeeded(request) && <div className="history-action"><strong>Action needed: verify receiving wallet</strong><button type="button" className="subtle-button" disabled={verificationBusyId === request.id} onClick={() => onVerify(request)}>{verificationBusyId === request.id ? 'Waiting for wallet…' : 'Verify receiving wallet'}</button>{verificationErrors[request.id] && <small role="alert">{verificationErrors[request.id]}</small>}</div>}</article>) : <div className="empty-state"><Clock3/><strong>No private requests yet</strong><p>Confirm a destination and submit the fixed test route when you are ready for operator review.</p><button className="subtle-button" onClick={() => navigate('/swap')}>Explore the route</button></div>}</section></>}
  </div></ProductPage>;
}

function AgentCardView({ card }: { card: AgentFactCard }) {
  if (card.kind === 'route-explanation') return <aside className="agent-fact-card"><strong>Verified route facts</strong><span>{card.source.amount} {card.source.asset} on {card.source.network} → {card.destination.amount} test {card.destination.asset} on {card.destination.network}</span><span>{card.privacy}</span><small>No live quote · no spending authority</small></aside>;
  if (card.kind === 'route-availability') return <aside className="agent-fact-card"><strong>Route availability</strong>{card.routes.map(route => <span key={route.routeId}>{route.title}: {route.availability.replaceAll('-', ' ')}</span>)}<small>Only registry-enabled routes can open a request flow.</small></aside>;
  if (card.kind === 'quote-comparison') return <aside className="agent-fact-card"><strong>Verified quote comparison</strong><span>{card.reason}</span><small>{card.fixedTestTerms.source} → {card.fixedTestTerms.destination} is fixed test data, not a market quote.</small></aside>;
  if (card.kind === 'review-preparation') return <aside className="agent-fact-card"><strong>Prepare your review</strong><span>{card.exactTerms}</span><span>{card.checklist.join(' · ')}</span><small>Preview only · creates no order · authorizes no payment</small></aside>;
  if (card.kind === 'order-status') return <aside className="agent-fact-card"><strong>Authorized backend status</strong><span>{card.status.replaceAll('_', ' ')}</span><small>Request {short(card.requestId)} · receipt {card.receiptAvailable ? 'available' : 'not available'}</small></aside>;
  return <aside className="agent-fact-card"><strong>Failure and recovery</strong><span>{card.status.replaceAll('_', ' ')} · {card.failureCode}</span><small>{card.guidance}</small></aside>;
}

function VoiceControls({ capabilities, locale, authenticated, onUseTranscript, speakText }: { capabilities: PublicCapabilities | null; locale: SupportedLocale; authenticated: boolean; onUseTranscript: (text: string) => void; speakText?: string }) {
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<'idle' | 'requesting' | 'recording' | 'processing' | 'review' | 'playing' | 'error'>('idle');
  const [transcript, setTranscript] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null); const stream = useRef<MediaStream | null>(null); const chunks = useRef<Blob[]>([]); const startedAt = useRef(0); const timer = useRef<number | undefined>(undefined);
  const available = Boolean(capabilities?.voice.enabled && authenticated);
  const review = reviewVoiceTranscript(transcript);

  function cleanup() { if (timer.current) window.clearTimeout(timer.current); timer.current = undefined; stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; recorder.current = null; chunks.current = []; }
  useEffect(() => cleanup, []);
  async function start() {
    setVoiceError('');
    if (!consent) { setVoiceError('Accept the audio processing and retention notice before requesting microphone access.'); setState('error'); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setVoiceError('This browser does not support microphone recording. Use text instead.'); setState('error'); return; }
    setState('requesting');
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.current = media;
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(type => MediaRecorder.isTypeSupported(type));
      const next = new MediaRecorder(media, preferred ? { mimeType: preferred } : undefined); recorder.current = next; chunks.current = []; startedAt.current = performance.now();
      next.ondataavailable = event => { if (event.data.size) chunks.current.push(event.data); };
      next.onerror = () => { cleanup(); setVoiceError('Recording failed. Use text or try again.'); setState('error'); };
      next.onstop = () => { void (async () => {
        const duration = performance.now() - startedAt.current; const blob = new Blob(chunks.current, { type: next.mimeType || 'audio/webm' }); cleanup();
        if (duration < VOICE_CAPTURE_LIMITS.minimumDurationMs) { setVoiceError('Recording was too short. Speak for at least half a second.'); setState('error'); return; }
        if (blob.size > VOICE_CAPTURE_LIMITS.maximumBytes) { setVoiceError('Recording exceeded the 2 MB limit. Use a shorter recording.'); setState('error'); return; }
        setState('processing');
        try { const text = await transcribeVoice(blob, duration, locale); setTranscript(text); setState('review'); }
        catch (caught) { setVoiceError(caught instanceof Error ? caught.message : 'Transcription failed. Use text instead.'); setState('error'); }
      })(); };
      next.start(250); setState('recording'); timer.current = window.setTimeout(() => next.state === 'recording' && next.stop(), VOICE_CAPTURE_LIMITS.maximumDurationMs);
    } catch { cleanup(); setVoiceError('Microphone permission was refused or unavailable. You can continue with text.'); setState('error'); }
  }
  function stop() { if (recorder.current?.state === 'recording') recorder.current.stop(); }
  async function speak() {
    if (!speakText || locale === 'fr') return;
    setVoiceError(''); setState('playing');
    try { const blob = await synthesizeVoice(speakText.slice(0, 200), locale); const url = URL.createObjectURL(blob); const audio = new Audio(url); audio.onended = () => { URL.revokeObjectURL(url); setState('idle'); }; audio.onerror = () => { URL.revokeObjectURL(url); setVoiceError('Voice playback failed. The text remains available.'); setState('error'); }; await audio.play(); }
    catch (caught) { setVoiceError(caught instanceof Error ? caught.message : 'Voice playback failed.'); setState('error'); }
  }
  if (!capabilities?.voice.enabled || !authenticated) return null;
  return <section className="voice-controls" aria-label="Optional voice input"><label className="voice-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)}/><span>I choose to send this recording to Groq for transcription. Audio is held only in server memory until the provider responds; provider processing and abuse logs may apply.</span></label><div className="voice-actions">{state === 'recording' ? <button type="button" className="record-button active" onClick={stop}><Square size={14}/>Stop recording</button> : <button type="button" className="record-button" disabled={!available || state === 'processing' || state === 'requesting'} onClick={() => void start()}><Mic size={15}/>{state === 'requesting' ? 'Requesting permission…' : state === 'processing' ? 'Transcribing…' : 'Record up to 30s'}</button>}{speakText && <button type="button" className="text-button" disabled={!consent || locale === 'fr' || state === 'playing'} onClick={() => void speak()}><Volume2 size={14}/>{locale === 'fr' ? 'French: text only' : state === 'playing' ? 'Playing…' : 'Read latest answer'}</button>}</div>{state === 'recording' && <div className="recording-state" role="status"><span/>Recording now · voice never approves a transfer</div>}{state === 'review' && <div className="transcript-review"><label><span>Review and correct the transcript</span><textarea value={transcript} maxLength={2000} onChange={event => setTranscript(event.target.value)}/></label>{!review.safeToPrepare && review.reason === 'incorrect-amount' && <p role="alert">The amount does not match the only supported terms: 0.01 TAZ → 1 test USDC. Correct it before using this text.</p>}<button type="button" className="subtle-button" disabled={!review.safeToPrepare} onClick={() => { onUseTranscript(transcript.trim()); setState('idle'); }}>Use reviewed text</button><small>This copies text into the question box. It does not create an order, sign, pay, or approve anything.</small></div>}{voiceError && <p className="voice-error" role="alert">{voiceError}</p>}</section>;
}

function AgentPanel({ capabilities, locale, authenticated }: { capabilities: PublicCapabilities | null; locale: 'en' | 'fr' | 'ar'; authenticated: boolean }) {
  const [message, setMessage] = useState('');
  const [conversation, setConversation] = useState<Array<{ role: 'user' | 'assistant'; text: string; factCards?: AgentFactCard[]; error?: boolean }>>([{ role: 'assistant', text: translate(locale, 'agentGreeting') }]);
  const [working, setWorking] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); if (!message.trim()) return; const input = message.trim(); setMessage(''); setWorking(true); setConversation(items => [...items, { role: 'user', text: input }]); try { const reply: AgentReply = await sendAgentMessage(input, locale); setConversation(items => [...items, { role: 'assistant', text: reply.text, ...(reply.factCards ? { factCards: reply.factCards } : {}) }]); } catch (caught) { setConversation(items => [...items, { role: 'assistant', text: caught instanceof Error ? caught.message : 'Assistant unavailable.', error: true }]); } finally { setWorking(false); } }
  const latestAssistant = [...conversation].reverse().find(item => item.role === 'assistant')?.text;
  const suggestions = ['What stays private?', 'Is the route open?', 'What is the refund policy?', 'How do I recover a request?'];
  return <aside className="agent-panel" aria-busy={working}><div className="panel-top"><div><span className="kicker"><Bot size={14}/> Guided help</span><h2>Ask before you move.</h2></div><span className="small-chip muted">{capabilities?.agent.mode === 'model-backed' ? 'External model configured' : 'Reviewed answers'} · no authority</span></div><div className="help-suggestions" aria-label="Suggested questions">{suggestions.map(question=><button type="button" key={question} onClick={()=>setMessage(question)}>{question}</button>)}</div><div className="conversation" aria-live="polite">{conversation.slice(-5).map((item, index) => <div className="agent-message" key={`${item.text}-${index}`}><p role={item.error ? 'alert' : undefined} className={item.error ? 'agent-answer agent-error' : item.role === 'assistant' ? 'agent-answer' : 'agent-prompt'}>{item.text}</p>{item.factCards?.map((card, cardIndex) => <AgentCardView card={card} key={`${card.kind}-${cardIndex}`}/>)}</div>)}{working && <div className="agent-thinking" role="status"><span/><span/><span/>Checking approved route facts…</div>}</div><form className="agent-form" onSubmit={event => void submit(event)}><label><span className="sr-only">Ask Zecori help</span><input value={message} disabled={working} onChange={event => setMessage(event.target.value)} maxLength={2000} placeholder="Ask about privacy, status, refunds, or recovery"/></label><button className="icon-button" disabled={working} aria-label="Send question"><Send size={17}/></button></form><VoiceControls capabilities={capabilities} locale={locale} authenticated={authenticated} onUseTranscript={setMessage} speakText={latestAssistant}/></aside>;
}

function WalletOption({ selected, title, body, onClick, disabled = false }: { selected: boolean; title: string; body: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className={`wallet-option ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={onClick} disabled={disabled}><span className="wallet-option-mark">{selected ? <Check size={14}/> : null}</span><span><strong>{title}</strong><small>{body}</small></span></button>;
}

export default function App() {
  const privy = usePrivyBridge();
  const locale = resolveLocale(navigator.language);
  const [route, setRoute] = useState(window.location.pathname);
  const [capabilities, setCapabilities] = useState<PublicCapabilities | null>(null);
  const [session, setSession] = useState<UserSession>({ authenticated: false });
  const [requests, setRequests] = useState<PublicOrderRequest[]>([]);
  const [routeStep, setRouteStep] = useState<0 | 1 | 2>(0);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [sourceChoice, setSourceChoice] = useState<WalletChoice>('unselected');
  const [destinationChoice, setDestinationChoice] = useState<WalletChoice>('unselected');
  const [sourceCheck, setSourceCheck] = useState<WalletReadiness | null>(null);
  const [noirCheck, setNoirCheck] = useState<NoirWalletReadiness | null>(null);
  const [noirBusy, setNoirBusy] = useState(false);
  const noirWallet = useRef<NoirWalletProvider | null>(null);
  const noirUnsubscribe = useRef<() => void>(() => undefined);
  const [destinationCheck, setDestinationCheck] = useState<WalletReadiness | null>(null);
  const [manualRecipient, setManualRecipient] = useState('');
  const [manualPasteError, setManualPasteError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [destinationConfirmed, setDestinationConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [injectedProviders, setInjectedProviders] = useState<InjectedWalletProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [verificationBusyId, setVerificationBusyId] = useState<string>();
  const [verificationErrors, setVerificationErrors] = useState<Record<string, string>>({});

  const selectedProvider = injectedProviders.find(item => item.id === selectedProviderId);

  useEffect(() => { const handler = () => setRoute(window.location.pathname); window.addEventListener('popstate', handler); return () => window.removeEventListener('popstate', handler); }, []);
  useEffect(() => subscribeInjectedWalletProviders(window, providers => {
    setInjectedProviders(providers);
    setSelectedProviderId(current => providers.length === 1 ? providers[0].id : providers.some(item => item.id === current) ? current : '');
  }), []);
  useEffect(() => {
    const provider = selectedProvider?.provider; if (!provider?.on) return;
    const invalidate = () => { setDestinationCheck({ ready:false, code:'UNAVAILABLE', message:'Wallet account, network, or connection changed. Check the destination again.' }); setDestinationConfirmed(false); };
    provider.on('accountsChanged', invalidate); provider.on('chainChanged', invalidate); provider.on('disconnect', invalidate);
    return () => { provider.removeListener?.('accountsChanged', invalidate); provider.removeListener?.('chainChanged', invalidate); provider.removeListener?.('disconnect', invalidate); };
  }, [selectedProvider]);
  useEffect(() => {
    let disposed = false;
    const restore = async () => {
      const wallet = await detectOfficialNoirWallet();
      if (disposed) return;
      noirWallet.current = wallet;
      const next = await inspectNoirWallet(wallet, 'silent');
      if (disposed) return;
      setNoirCheck(next);
      if (next.authorized) setSourceChoice('connected-read-only');
      if (wallet) noirUnsubscribe.current = subscribeToNoirAccountChanges(wallet, () => {
        setSourceChoice('connected-read-only');
        setNoirCheck(current => current ? { ...current, ready: false, code: 'STALE', message: 'The Noir account changed. Rechecking the current authorization and balance…' } : current);
        void inspectNoirWallet(wallet, 'silent').then(refreshed => { if (!disposed) setNoirCheck(refreshed); });
      });
    };
    void restore();
    const expiryTimer = window.setInterval(() => setNoirCheck(current => current ? expireNoirReadiness(current) : current), 1_000);
    return () => { disposed = true; noirUnsubscribe.current(); window.clearInterval(expiryTimer); };
  }, []);
  useEffect(() => { void Promise.all([getCapabilities(), getSession()]).then(async ([next, identity]) => { setCapabilities(next); setSession(identity); setRequests(identity.authenticated ? await listOrderRequests() : []); }).catch(caught => setError(caught instanceof Error ? caught.message : 'Service unavailable')); }, []);
  const active = useMemo(() => requests.find(item => !finalStatuses.has(item.status)), [requests]);
  const latestCompleted = useMemo(() => requests.find(item => item.status === 'COMPLETED'), [requests]);
  const selectedRequestId = requestIdFromRoute(route);
  const selectedRequest = selectedRequestId ? requests.find(item => item.id === selectedRequestId) : undefined;
  const displayedRequest = selectedRequestId ? selectedRequest : active ?? latestCompleted;
  // The current Noir SDK cannot attest testnet/Ironwood, so only the external
  // instruction path may satisfy request readiness in this release.
  const sourceReady = sourceChoice === 'external';
  const manualCheck = destinationChoice === 'external' ? validateManualBaseRecipient(manualRecipient) : null;
  const destinationReady = destinationChoice === 'connected-read-only' ? destinationCheck?.ready === true : manualCheck?.ready === true;
  const recipient = destinationChoice === 'connected-read-only' ? destinationCheck?.account : manualCheck?.account;
  const currentStep = displayedRequest ? trackingStage[displayedRequest.status] : routeStep;

  async function reloadIdentity() { const identity = await getSession(); setSession(identity); setRequests(identity.authenticated ? await listOrderRequests() : []); }
  async function register(name: string) { setBusy(true); setError(null); try { await registerPasskey(name, 'Primary passkey'); await reloadIdentity(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Passkey registration failed'); } finally { setBusy(false); } }
  async function login() { setBusy(true); setError(null); try { await loginWithPasskey(); await reloadIdentity(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Passkey login failed'); } finally { setBusy(false); } }
  async function usePrivyLogin() {
    setError(null);
    if (!privy.authenticated) { privy.openLogin(); return; }
    setBusy(true); try { const token = await privy.getAccessToken(); if (!token) throw new Error('Privy did not provide an access token.'); await loginWithPrivy(token); await reloadIdentity(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Privy login failed'); } finally { setBusy(false); }
  }
  async function connectPrivy() {
    setError(null);
    if (!privy.authenticated) { privy.openLogin(); return; }
    setBusy(true); try { const token = await privy.getAccessToken(); if (!token) throw new Error('Privy did not provide an access token.'); await linkPrivy(token); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Privy account linking failed'); } finally { setBusy(false); }
  }
  async function addPasskey() { setBusy(true); setError(null); try { await registerPasskey(session.user?.displayName ?? 'Zecori account', `Additional passkey ${session.user?.passkeyCount ? session.user.passkeyCount + 1 : 2}`, true); await reloadIdentity(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Passkey registration failed'); } finally { setBusy(false); } }
  async function signOut() { setBusy(true); setError(null); try { await logout(); if (privy.authenticated) await privy.logout(); await reloadIdentity(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Logout failed'); } finally { setBusy(false); } }
  async function refresh() { setBusy(true); setError(null); try { setRequests(await listOrderRequests()); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Refresh failed'); } finally { setBusy(false); } }
  async function checkBase() {
    setDestinationChoice('connected-read-only');
    setDestinationCheck({ ready: false, code: 'UNAVAILABLE', message: 'Checking chain and existing authorization…' });
    if (!selectedProvider) { setDestinationCheck({ ready: false, code: 'NOT_DETECTED', message: 'Select the wallet provider that controls the receiving address.' }); return; }
    setDestinationCheck(await inspectBaseReadOnlyProvider(selectedProvider.provider));
  }
  async function connectNoir() {
    if (noirBusy) return;
    setSourceChoice('connected-read-only'); setSourceCheck(null); setNoirBusy(true);
    try {
      const wallet = noirWallet.current ?? await detectOfficialNoirWallet();
      noirWallet.current = wallet;
      if (wallet && noirCheck?.code === 'NOT_DETECTED') {
        noirUnsubscribe.current();
        noirUnsubscribe.current = subscribeToNoirAccountChanges(wallet, () => {
          setSourceChoice('connected-read-only');
          setNoirCheck(current => current ? { ...current, ready: false, code: 'STALE', message: 'The Noir account changed. Recheck before continuing.' } : current);
        });
      }
      setNoirCheck(await inspectNoirWallet(wallet, 'interactive'));
    } finally { setNoirBusy(false); }
  }
  async function verifyRequest(request: PublicOrderRequest): Promise<void> {
    if (!destinationVerificationNeeded(request) || !request.destinationReview) throw new Error('This request is not eligible for destination verification. Refresh Activity and try again.');
    if (!selectedProvider) throw new Error('Select the wallet provider that controls the receiving address before verifying.');
    const verificationProvider = selectedProvider.provider;
    setVerificationBusyId(request.id); setVerificationErrors(current => { const next = { ...current }; delete next[request.id]; return next; });
    try {
      const reviewedRecipient = request.destinationReview.recipient;
      const challenge = await issueDestinationChallenge(request.id);
      if (challenge.requestId !== request.id || !sameEvmAddress(challenge.recipient, reviewedRecipient)) throw new Error('The server challenge does not match the reviewed receiving address. The proof was not submitted.');
      const signature = await requestDestinationControlSignature(verificationProvider, reviewedRecipient, challenge.typedData);
      await assertLocalDestinationSigner(challenge.typedData, signature, reviewedRecipient);
      await verifyDestinationChallenge(challenge.challengeId, signature);
      const verified = await getOrderRequest(request.id);
      setRequests(items => [verified, ...items.filter(item => item.id !== verified.id)]);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Destination verification failed safely. No proof was submitted.';
      setVerificationErrors(current => ({ ...current, [request.id]: message }));
      throw caught;
    } finally { setVerificationBusyId(undefined); }
  }
  async function retryVerification(request: PublicOrderRequest) {
    setError(null);
    try { await verifyRequest(request); }
    catch { /* A request-scoped, privacy-safe error is already displayed. */ }
  }
  async function create() {
    if (!recipient || !sourceReady || !destinationReady || !termsAccepted || !destinationConfirmed || !capabilities) return;
    const intent: WalletReadinessIntent = { routeId: 'zcash-testnet-to-base-sepolia-fixed', amountZatoshis: '1000000', termsAccepted: true, source: { mode: sourceChoice === 'external' ? 'external' : 'connected-read-only', network: 'zcash-testnet', pool: 'ironwood' }, destination: { mode: destinationChoice === 'external' ? 'manual' : 'connected-read-only', network: 'base-sepolia', chainId: 84532, contract: capabilities.route.destination.contract, address: recipient }, destinationConsent: { version: 'base-destination-intent-v1', statement: 'I confirm this exact Base Sepolia address is the intended USDC recipient. This records my intent and does not prove that I control the wallet.', confirmed: true } };
    let createdRequest: PublicOrderRequest | undefined;
    setBusy(true); setError(null); try {
      const request = await createOrderRequest(intent); createdRequest = request;
      setRequests(items => [request, ...items.filter(item => item.id !== request.id)]);
      await verifyRequest(request);
    } catch (caught) {
      if (!createdRequest) setError(caught instanceof Error ? caught.message : 'Request creation failed safely.');
    } finally { setBusy(false); }
  }

  const identity: IdentityProps = { session, busy, privyEnabled: privy.enabled, privyAuthenticated: privy.authenticated, onRegister: name => void register(name), onLogin: () => void login(), onPrivy: () => void usePrivyLogin(), onLinkPrivy: () => void connectPrivy(), onAdd: () => void addPasskey(), onLogout: () => void signOut() };
  const serviceLoading = capabilities === null && error === null;
  if (route === '/') return <Landing/>;
  if (route.startsWith('/docs')) return <DocsSite pathname={route} navigate={navigate} locale={locale}/>;
  if (route === '/history' || route === '/activity') return <History requests={requests} locale={locale} identity={identity} loading={serviceLoading} error={error} onVerify={request => void retryVerification(request)} verificationBusyId={verificationBusyId} verificationErrors={verificationErrors} providers={injectedProviders} selectedProviderId={selectedProviderId} onSelectProvider={setSelectedProviderId}/>;
  if (route === '/account') return <AccountSurface navigate={navigate} authenticated={session.authenticated} locale={locale} identity={<><ServiceNotice loading={serviceLoading} error={error}/><IdentityPanel {...identity}/></>}/>;
  if (route === '/inbox') return <InboxSurface navigate={navigate} authenticated={session.authenticated} locale={locale}/>;
  if (route === '/assistant' || route === '/help') return <AssistantSurface navigate={navigate} locale={locale} assistant={<div className="assistant-primary"><ServiceNotice loading={serviceLoading} error={error}/><AgentPanel capabilities={capabilities} locale={locale} authenticated={session.authenticated}/></div>}/>;
  if (!(route === '/swap' || route.startsWith('/swap/'))) return <NotFound navigate={navigate}/>;
  const terms = capabilities?.route;
  const routeOpen = capabilities?.orderCreation.enabled === true;
  const requestReady = Boolean(routeStep === 2 && session.authenticated && sourceReady && destinationReady && termsAccepted && destinationConfirmed && routeOpen);

  return <div className="page" lang={locale} dir={localeDirection(locale)}><a className="skip-link" href="#main">Skip to move</a><ProductHeader current="routes" navigate={navigate} locale={locale}/><JourneyRail current={currentStep}/>
    <main className="main" id="main">
      <section className="route-app-hero"><div><div className="eyebrow"><span className="eyebrow-bar"/> Home / Move</div><h1>Move from a shielded source.</h1><p className="lead">One experimental testnet path, with its availability and privacy limits shown before any wallet or account step.</p></div><button className="text-button" onClick={()=>navigate('/help')}>Questions? Open Help <ArrowRight size={15}/></button></section>
      <ServiceNotice loading={serviceLoading} error={error}/>
      <section className={`availability-panel ${routeOpen ? 'open' : 'closed'}`} aria-live="polite">
        <div className="availability-copy"><span className="kicker">Current availability</span><h2>{routeOpen ? 'Available for a reviewed test request' : 'Not available for transfers'}</h2><p>{routeOpen ? 'The backend reports current operator attestation, test liquidity, and valid fixed terms. Continue only if you intend to make a testnet request.' : capabilities?.orderCreation.reason ?? 'Checking the current route status. No transfer controls are available yet.'}</p></div>
        <div className="fixed-terms" aria-label="Experimental fixed test terms"><span><small>You would send</small><strong>0.01 TAZ</strong><em>Zcash testnet · Ironwood</em></span><ArrowRight aria-hidden="true"/><span><small>Test outcome</small><strong>{terms?.destination.amount ?? '1'} test USDC</strong><em>Base Sepolia · chain 84532</em></span></div>
        <p className="fixed-terms-note"><strong>Experimental fixed test terms—not a live exchange quote.</strong> Trusted LP, manual operator approval, unquoted wallet/network fees, and no automatic refund guarantee.</p>
        {!routeOpen && <div className="closed-actions"><button className="subtle-button" type="button" aria-expanded={showWalkthrough} onClick={()=>setShowWalkthrough(value=>!value)}>Explore how it works <ArrowRight size={15}/></button><span>No wallet connection, request, payment address, or transaction will be created.</span></div>}
        {routeOpen && routeStep === 0 && <button className="primary-button availability-continue" onClick={()=>setRouteStep(1)}>Continue to wallet setup <ArrowRight size={16}/></button>}
      </section>

      {!routeOpen && showWalkthrough && <section className="walkthrough-panel" aria-labelledby="walkthrough-heading"><span className="kicker">Nonfinancial walkthrough</span><h2 id="walkthrough-heading">What happens only after the route reopens</h2><ol><li><strong>Choose a shielded source.</strong><span>Manual Zcash testnet instructions remain hidden until an operator accepts a private request.</span></li><li><strong>Confirm the public destination.</strong><span>Base Sepolia chain and account are checked, then an EIP-712 signature proves control without granting spend authority.</span></li><li><strong>Wait for verified instructions.</strong><span>A dedicated Ironwood receiver appears only after acceptance and allocation checks. Until then, do not send funds.</span></li><li><strong>Follow genuine activity.</strong><span>Receipts appear only after independent source and destination evidence. Failed or uncertain states never become success.</span></li></ol><div className="inline-actions"><button className="text-button" onClick={()=>navigate('/activity')}>View Activity</button><button className="text-button" onClick={()=>navigate('/docs/order-recovery')}>Read recovery guidance</button></div></section>}

      {routeOpen && routeStep === 1 && <section className="progressive-panel" aria-labelledby="wallet-heading"><div className="panel-top"><div><span className="kicker">Step 2 of 3 · Wallet setup</span><h2 id="wallet-heading">Choose source and destination</h2></div><button className="text-button" onClick={()=>setRouteStep(0)}><ArrowLeft size={14}/>Back</button></div><p className="section-intro">Choose how you will make the eventual shielded Zcash payment. Selecting a wallet creates no payment, and no receiver is published before operator authorization and allocation.</p><div className="wallet-grid"><div className="wallet-group"><div className="wallet-heading"><span className="asset-mark zec">Z</span><div><strong>Source wallet</strong><small>Zcash testnet · Ironwood shielded only</small></div></div><WalletOption selected={sourceChoice === 'connected-read-only'} title={noirBusy?'Waiting for Noir Wallet…':noirCheck?.authorized?'Recheck connected Noir Wallet':'Connect Noir Wallet'} body="Integrated guarded path. Reads only authorized account readiness; sending stays disabled until testnet and Ironwood can be attested." onClick={()=>void connectNoir()}/>{noirCheck&&<div className={`wallet-result ${noirCheck.ready?'ready':'blocked'}`}><span/>{noirCheck.message}</div>}{noirCheck?.account&&<div className="noir-account-summary"><div><small>Authorized account</small><strong>{noirCheck.account.label || 'Unnamed account'}</strong><span>{noirCheck.account.authorizedCount} authorized</span></div>{noirCheck.balance&&<dl><div><dt>Shielded</dt><dd>{noirCheck.balance.shielded} ZEC</dd></div><div><dt>Available</dt><dd>{noirCheck.balance.available} ZEC</dd></div><div><dt>Pending</dt><dd>{noirCheck.balance.pending} ZEC</dd></div><div><dt>Funding</dt><dd>{noirCheck.balance.status.replace('-', ' ')}</dd></div></dl>}<small>Kept in memory only · address hidden · build {noirCheck.extensionVersion??'unverifiable'} · testnet/Ironwood unverified</small></div>}<WalletOption selected={sourceChoice === 'external'} title="Use another Zcash wallet" body="External-wallet path. No specific wallet is claimed compatible; PAYMENT_READY will provide exact shielded testnet instructions for manual review." onClick={()=>{setSourceChoice('external');setSourceCheck({ready:true,code:'READY',message:'External-wallet path selected. This is a future manual payment path, not a compatibility claim. Never use transparent funds and do not send before PAYMENT_READY.'})}}/>{sourceChoice==='external'&&sourceCheck&&<div className="wallet-result ready"><span/>{sourceCheck.message}</div>}<small className="wallet-support-note">Verified today: instruction safety and receiver integrity. Unverified: payment behavior of any named external wallet.</small></div>
        <div className="wallet-group"><div className="wallet-heading"><span className="asset-mark base">B</span><div><strong>Public destination</strong><small>Base Sepolia · exact chain 84532</small></div></div><span className="preferred-label">Preferred</span><WalletProviderPicker providers={injectedProviders} selectedId={selectedProviderId} onSelect={id => { setSelectedProviderId(id); setDestinationCheck(null); setDestinationConfirmed(false); }}/><WalletOption selected={destinationChoice==='connected-read-only'} title="Use connected Base wallet" body="Reads the exact chain ID and already-authorized account, then proves control of that same account with EIP-712." onClick={()=>void checkBase()}/><WalletOption selected={destinationChoice==='external'} title="Enter a recipient address" body="Records recipient intent only. It is not ownership proof and still requires that exact wallet to sign." onClick={()=>{setDestinationChoice('external');setDestinationConfirmed(false)}}/>{destinationChoice==='external'&&<label className="recipient-field"><span>Base Sepolia recipient</span><input value={manualRecipient} onChange={event=>{setManualRecipient(event.target.value);setManualPasteError(null);setDestinationConfirmed(false)}} onPaste={event=>{event.preventDefault();try{const exact=recipientFromClipboard(event.clipboardData.getData('text/plain'));setManualRecipient(exact);setManualPasteError(null)}catch(caught){setManualPasteError(caught instanceof Error?caught.message:'Clipboard address was rejected.')}setDestinationConfirmed(false)}} placeholder="0x…" autoComplete="off" spellCheck={false}/>{manualPasteError&&<small role="alert">{manualPasteError}</small>}<small className={!manualPasteError&&manualCheck?.ready?'success-text':''}>{manualCheck?.message}</small></label>}{destinationChoice==='connected-read-only'&&destinationCheck&&<div className={`wallet-result ${destinationCheck.ready?'ready':'blocked'}`}><span/>{destinationCheck.message}{destinationCheck.account?` ${short(destinationCheck.account)}`:''}</div>}</div></div><div className="binding-blocker"><LockKeyhole/><div><strong>Recipient intent and ownership proof remain separate</strong><p>Zecori validates checksum, rejects the zero address, binds Base Sepolia chain 84532 and the exact test-USDC contract, then rechecks the same account and chain before and after EIP-712 signing. An account or network change invalidates review; no recipient is silently substituted.</p></div></div><div className="progressive-actions"><button className="primary-button" disabled={!sourceReady||!destinationReady} onClick={()=>setRouteStep(2)}>Review exact terms <ArrowRight size={16}/></button></div></section>}

      {routeOpen && routeStep === 2 && <section className="progressive-panel" aria-labelledby="review-heading"><div className="panel-top"><div><span className="kicker">Step 3 of 3 · Review</span><h2 id="review-heading">Confirm before requesting</h2></div><button className="text-button" onClick={()=>setRouteStep(1)}><ArrowLeft size={14}/>Edit wallets</button></div><div className="review-grid"><dl><div><dt>Fixed terms</dt><dd>0.01 TAZ → 1 test USDC; not a market quote</dd></div><div><dt>Confirmations</dt><dd>{terms?`${terms.source.confirmations} Zcash · ${terms.destination.confirmations} Base`:'10 Zcash · 3 Base'}</dd></div><div><dt>Custody</dt><dd>{terms?.custody??'Trusted provider custody during settlement.'}</dd></div><div><dt>Refunds</dt><dd>{terms?.refunds??'Manual review; no automatic refund guarantee.'}</dd></div></dl><label className="terms-check"><input type="checkbox" checked={destinationConfirmed} disabled={!recipient||!destinationReady} onChange={event=>setDestinationConfirmed(event.target.checked)}/><span><strong>I confirm this exact Base Sepolia recipient.</strong><small>{recipient?short(recipient):'Return to wallet setup.'} · Intent only; wallet control is proven next.</small></span></label><label className="terms-check"><input type="checkbox" checked={termsAccepted} onChange={event=>setTermsAccepted(event.target.checked)}/><span><strong>I understand these fixed experimental terms.</strong><small>No receiver exists yet. Late payments and refunds require manual review.</small></span></label></div><IdentityPanel {...identity}/><div className="request-gate"><div><strong>Explicit destination-control proof required</strong><p>The button requests wallet permission and one EIP-712 signature bound to the account, recipient, chain, origin, purpose, nonce, and expiry.</p></div><button className="primary-button" disabled={!requestReady||busy} onClick={()=>void create()}>{busy?'Waiting for wallet…':!session.authenticated?'Sign in before requesting':'Verify destination & request review'}<ArrowRight size={17}/></button></div><p className="fine-print">This is not a source-payment signature, payout approval, transaction, or spending authorization.</p></section>}

      <section className="safety-strip" aria-label="Privacy and authority boundaries"><span><ShieldCheck/>Ironwood source only</span><span><WalletCards/>Base payout is public</span><span><LockKeyhole/>Trusted LP can correlate both legs</span><span><Link2/>Help has no transaction authority</span></section>
      {selectedRequestId&&!selectedRequest&&session.authenticated&&<div className="inline-warning" role="alert"><CircleAlert size={17}/><span>This request is unavailable to the signed-in account. Return to Activity and choose an owned request.</span></div>}
      {displayedRequest&&destinationVerificationNeeded(displayedRequest)&&<section className="panel verification-provider"><WalletProviderPicker providers={injectedProviders} selectedId={selectedProviderId} onSelect={setSelectedProviderId}/></section>}
      {displayedRequest&&<RequestCard request={displayedRequest} onRefresh={()=>void refresh()} onVerify={request=>void retryVerification(request)} verificationBusy={verificationBusyId===displayedRequest.id} verificationError={verificationErrors[displayedRequest.id]} locale={locale}/>}<footer className="footer"><span>Zecori · shielded-source cross-chain testnet research</span><span>{locale.toUpperCase()} · {localeMetadata[locale].translationReview.replaceAll('-', ' ')} · <a href="/activity" onClick={event=>{event.preventDefault();navigate('/activity')}}>private activity <ExternalLink size={11}/></a></span></footer>
    </main></div>;
}
