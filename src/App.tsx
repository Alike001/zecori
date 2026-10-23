import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ArrowDown, ArrowLeft, ArrowRightLeft, BookOpen, CheckCircle2, CircleAlert, Download, EyeOff, Globe2, LockKeyhole, Printer, Search, ShieldCheck, Wallet, XCircle } from 'lucide-react';
import { destinations, readCatalogue, validZecAmount, type Catalogue, type Token } from './lib/catalogue';
import { getFinalReceipt, listOrders } from './lib/order-api';
import { displayOrderStatus } from './lib/order-coordinator.ts';
import type { ShareableReceipt } from './lib/receipt.ts';
import type { OrderView } from '../server/order-api.ts';
import { noir, walletStore } from './wallet/noir';

const mask = (address: string | null) => !address ? 'Unavailable' : `${address.slice(0, 11)}…${address.slice(-7)}`;
const title = (token: Token) => `${token.symbol} on ${token.blockchain}`;

function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function HistoryPage({ orders }: { orders: OrderView[] }) {
  return <main className="main history-page">
    <div className="page-nav"><button className="subtle-button" onClick={() => navigate('/')}><ArrowLeft size={15}/> Aggregator</button><span className="mode">TRANSACTION HISTORY</span></div>
    <div className="eyebrow"><span className="eyebrow-bar"/> OPERATIONS / HISTORY</div>
    <h1>Transaction<br/><span>history.</span></h1>
    <p className="lead">Every order remains distinguishable from a final settlement receipt. Pending, failed and unresolved observations are not completed payments.</p>
    <section className="panel history-table" aria-label="Transaction history">
      <div className="history-heading"><div><span className="section-label">ORDER LEDGER</span><h2>{orders.length} order{orders.length === 1 ? '' : 's'}</h2></div><span className="small-chip muted">Read-only</span></div>
      {orders.length === 0 ? <div className="empty-state">No orders have been persisted.</div> : <div className="history-rows">{orders.map(order => <button className="history-row" key={order.id} onClick={() => navigate(`/history/${encodeURIComponent(order.id)}`)}><div className="history-order-main"><strong>{order.id}</strong><small>{order.sourceAsset} on {order.sourceNetwork} → {order.destinationAsset.symbol} on {order.destinationNetwork}</small></div><div><small>Created</small><strong>{new Date(order.createdAt).toLocaleString()}</strong></div><span className={`status-chip status-${order.status.toLowerCase()}`}>{displayOrderStatus(order.status)}</span></button>)}</div>}
    </section>
  </main>;
}

function ReceiptActions({ receipt }: { receipt: ShareableReceipt }) {
  function download() {
    const html = `<!doctype html><meta charset="utf-8"><title>Receipt ${receipt.receiptId}</title><pre>${JSON.stringify(receipt, null, 2)}</pre><p>${receipt.printableNotice}</p>`;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `receipt-${receipt.receiptId}.html`; anchor.click(); URL.revokeObjectURL(url);
  }
  return <div className="receipt-actions"><button className="subtle-button" onClick={() => window.print()}><Printer size={15}/> Print-safe layout</button><button className="subtle-button" onClick={download}><Download size={15}/> Download redacted HTML</button></div>;
}

function DetailPage({ order, onBack }: { order: OrderView | undefined; onBack: () => void }) {
  const [receipt, setReceipt] = useState<ShareableReceipt | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  useEffect(() => {
    if (!order?.finalReceiptId) return;
    getFinalReceipt(order.finalReceiptId).then(setReceipt).catch(e => setReceiptError(e instanceof Error ? e.message : 'Receipt unavailable'));
  }, [order]);
  if (!order) return <main className="main"><button className="subtle-button" onClick={onBack}><ArrowLeft size={15}/> Back to history</button><div className="empty-state">Order not found.</div></main>;
  return <main className="main detail-page">
    <div className="page-nav"><button className="subtle-button" onClick={onBack}><ArrowLeft size={15}/> History</button><span className={`status-chip status-${order.status.toLowerCase()}`}>{displayOrderStatus(order.status)}</span></div>
    <div className="eyebrow"><span className="eyebrow-bar"/> ORDER / {order.id}</div>
    <h1>Transaction<br/><span>details.</span></h1>
    <section className="panel detail-grid"><div><span className="section-label">FIXED TERMS</span><dl><dt>Source</dt><dd>{order.amount} {order.sourceAsset} · {order.sourceNetwork}</dd><dt>Destination</dt><dd>1 {order.destinationAsset.symbol} · {order.destinationNetwork}</dd><dt>Recipient</dt><dd><code>Private</code></dd><dt>Created</dt><dd>{new Date(order.createdAt).toLocaleString()}</dd><dt>Expiry</dt><dd>{new Date(order.expiresAt).toLocaleString()}</dd></dl></div><div><span className="section-label">OBSERVATIONS</span><dl><dt>Source receipt</dt><dd>{order.sourceReceipt ? 'Independently verified' : 'Not independently verified'}</dd><dt>Destination receipt</dt><dd>{order.destinationReceipt ? 'Independently verified' : 'Not independently verified'}</dd><dt>Final receipt</dt><dd>{receipt ? receipt.receiptId : 'Not available'}</dd><dt>Private evidence</dt><dd>Redacted from browser responses</dd></dl></div></section>
    {receipt ? <section className="panel print-receipt"><div className="panel-top"><span className="section-label">FINAL RECEIPT</span><span className="small-chip"><ShieldCheck size={13}/> Independently verified</span></div><h2>Settlement receipt</h2><p className="proposal-sub">Transaction IDs and shielded source details are redacted from the browser view.</p><dl><dt>Receipt ID</dt><dd>{receipt.receiptId}</dd><dt>Destination settlement recorded</dt><dd>{new Date(receipt.destinationSettlementTimestamp).toLocaleString()}</dd><dt>Privacy classification</dt><dd>{receipt.privacyClassification}</dd></dl><ReceiptActions receipt={receipt}/><p className="fine-print">{receipt.printableNotice}</p></section> : <section className="panel pending-receipt"><CircleAlert size={18}/><div><h2>No final settlement receipt</h2><p>{receiptError ?? 'A final receipt is generated only after the coordinator verifies both source payment and destination settlement through trusted adapters. Client-submitted facts cannot complete this order.'}</p></div></section>}
  </main>;
}

export default function App() {
  const wallet = useSyncExternalStore(walletStore.subscribe, walletStore.getSnapshot);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [chain, setChain] = useState('all');
  const [chosen, setChosen] = useState<string>('');
  const [amount, setAmount] = useState('0.01');
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [route, setRoute] = useState(window.location.pathname);

  useEffect(() => {
    let active = true;
    fetch('/token-catalogue.json', { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error('Token catalogue unavailable. Run the import command in README.'); return r.json(); })
      .then(v => { if (active) setCatalogue(readCatalogue(v)); })
      .catch(e => { if (active) setCatalogueError(e instanceof Error ? e.message : 'Unable to read catalogue'); });
    return () => { active = false; };
  }, []);

  useEffect(() => { const onPop = () => setRoute(window.location.pathname); window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop); }, []);

  useEffect(() => {
    listOrders().then(setOrders).catch(() => setOrderError('Coordinator API unavailable. Start the Vite server to use order persistence.'));
  }, []);

  const networks = useMemo(() => [...new Set((catalogue?.tokens ?? []).filter(t => t.blockchain !== 'zec').map(t => t.blockchain))].sort(), [catalogue]);
  const filtered = useMemo(() => destinations(catalogue?.tokens ?? [], search, chain), [catalogue, search, chain]);
  const selected = useMemo(() => catalogue?.tokens.find(t => t.assetId === chosen), [catalogue, chosen]);

  async function connect() {
    setWalletError(null); setBusy(true);
    try { await walletStore.connect(noir.name); }
    catch (e) { setWalletError(e instanceof Error ? e.message : 'Wallet connection failed'); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    setWalletError(null); setBusy(true);
    try { await walletStore.disconnect(); setBalance(null); }
    catch (e) { setWalletError(e instanceof Error ? e.message : 'Wallet disconnect failed'); }
    finally { setBusy(false); }
  }
  async function revealBalance() {
    setWalletError(null); setBusy(true);
    try { const b = await noir.getBalance(); setBalance(b.shielded); }
    catch (e) { setWalletError(e instanceof Error ? e.message : 'Could not read balance'); }
    finally { setBusy(false); }
  }

  if (route === '/history') return <HistoryPage orders={orders}/>;
  if (route.startsWith('/history/')) return <DetailPage order={orders.find(order => order.id === decodeURIComponent(route.slice('/history/'.length)))} onBack={() => navigate('/history')}/>;

  return (
    <div className="page">
      <header className="header">
        <div className="brand"><span className="brand-symbol"><ShieldCheck size={20}/></span><span>ZECATHON <small>PROTOCOL LAB</small></span></div>
        <div className="header-side"><span className="mode">READ-ONLY PROTOTYPE</span><span className="status-dot"/></div>
      </header>

      <main className="main">
        <div className="eyebrow"><span className="eyebrow-bar"/> CROSS-CHAIN ENGINEERING / PHASE 01</div>
        <h1>Private source.<br/><span>Open destinations.</span></h1>
        <p className="lead">Connect Noir Wallet to inspect your shielded ZEC account. Explore destination assets sourced from a real NEAR Intents token catalogue. <strong>Swaps and payments are disabled until independently verified.</strong></p>
        <div className="safety-notice"><LockKeyhole size={17}/><span>This application does not request signatures, move funds, initiate quotes, or call a payout provider.</span></div>
        <div className="page-actions"><button className="subtle-button" onClick={() => navigate('/history')}>Open transaction history</button></div>

        <section className="cards">
          <article className="panel wallet-panel">
            <div className="panel-top"><span className="section-label">01 / SOURCE WALLET</span><span className="small-chip"><ShieldCheck size={13}/> Zcash</span></div>
            <div className="wallet-heading"><div className="wallet-icon"><Wallet size={24}/></div><div><h2>Noir Wallet</h2><p>Mainnet inspection only</p></div></div>
            <div className="wallet-status"><span className={wallet.isConnected ? 'dot green' : 'dot'}/>{wallet.isConnected ? 'Connected' : 'Not connected'}</div>
            {wallet.isConnected ? <>
              <div className="wallet-details"><div><small>Shielded receiver</small><code>{mask(wallet.shieldedAddress)}</code></div><div><small>Wallet network</small><strong>{wallet.chainId ?? 'Unknown'}</strong></div>{balance !== null && <div><small>Shielded balance (only shown on request)</small><strong>{balance} ZEC</strong></div>}</div>
              {!wallet.shieldedAddress && <p className="inline-warning"><CircleAlert size={15}/> Noir has not provided a shielded address. Investigate before any future spending.</p>}
              <div className="button-row"><button onClick={revealBalance} disabled={busy} className="subtle-button"><EyeOff size={16}/> {balance===null?'Show shielded balance':'Refresh balance'}</button><button onClick={disconnect} disabled={busy} className="subtle-button">Disconnect</button></div>
            </> : <button className="primary-button" onClick={connect} disabled={busy}><Wallet size={17}/>{busy ? 'Waiting for Noir…' : 'Connect Noir Wallet'}</button>}
            {walletError && <p className="inline-warning" role="alert"><XCircle size={16}/>{walletError}</p>}
            <p className="fine-print">This adapter remains mainnet read-only and is never used for testnet orders or payment activation. Testnet source funding is verified separately through Wallet A RPC.</p>
          </article>

          <article className="panel">
            <div className="panel-top"><span className="section-label">02 / DESTINATION EXPLORER</span><span className="small-chip"><Globe2 size={13}/> Multi-chain</span></div>
            <div className="explorer-title"><div><h2>Choose where value goes</h2><p>Browse advertised assets. A listing is not a live route.</p></div><span className="token-count">{catalogue ? `${catalogue.tokens.length} assets` : 'No data'}</span></div>
            {catalogueError ? <div className="empty-state"><CircleAlert size={18}/><span>{catalogueError}</span></div> : <>
              <div className="filters"><label className="search"><Search size={18}/><input aria-label="Find a destination token" placeholder="Search token or network" value={search} onChange={e=>setSearch(e.target.value)}/></label><select aria-label="Filter by network" value={chain} onChange={e=>setChain(e.target.value)}><option value="all">All networks</option>{networks.map(n=><option key={n} value={n}>{n}</option>)}</select></div>
              <div className="asset-list" aria-label="Destination token candidates">{filtered.slice(0,28).map(t=><button type="button" className={`asset-row ${chosen===t.assetId?'selected':''}`} onClick={()=>setChosen(t.assetId)} key={t.assetId}><div className="asset-icon">{t.symbol.slice(0,2).toUpperCase()}</div><span className="asset-desc"><strong>{t.symbol}</strong><small>{t.blockchain} · {t.decimals} decimals</small></span><span className="candidate">{chosen===t.assetId ? <CheckCircle2 size={19}/> : <ArrowRightLeft size={16}/>}</span></button>)}{filtered.length===0 && <div className="empty-state">No matching entries in the local catalogue.</div>}</div>
              {filtered.length>28 && <p className="fine-print">Showing the first 28 matches. Refine the search to find other tokens.</p>}
              <p className="fine-print">Imported catalogue: {catalogue ? new Date(catalogue.importedAt).toLocaleString() : 'Loading…'}. This is a local snapshot, not live availability.</p>
            </>}
          </article>
        </section>

        <section className="panel proposal">
          <div className="panel-top"><span className="section-label">03 / INTENT DRAFT</span><span className="small-chip muted">Execution locked</span></div>
          <h2>Review a proposed direction</h2><p className="proposal-sub">This draft does not fetch a price or reserve liquidity. It is a planning surface only.</p>
          <div className="intent-grid"><div className="intent-item"><small>Source</small><strong>Shielded ZEC</strong><input aria-label="ZEC input amount" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/>{!validZecAmount(amount) && <span className="error-small">Enter a positive ZEC amount (up to 8 decimals)</span>}</div><div className="intent-arrow"><ArrowDown/></div><div className="intent-item"><small>Destination</small><strong>{selected ? title(selected) : 'Select an asset above'}</strong><span className="destination-note">No executable quote verified</span></div></div>
          <div className="locked"><LockKeyhole size={17}/> Transfers disabled. A real shielded receiver, route policy, settlement proof and refund path must pass verification first.</div>
        </section>
        <section className="panel proposal coordinator-panel">
          <div className="panel-top"><span className="section-label">04 / ORDER COORDINATOR</span><span className="small-chip muted">Testnet only</span></div>
          <h2>Create fixed terms for observation</h2>
          <p className="proposal-sub">Creation, address binding, and activation are restricted to the authenticated local operator CLI. The browser cannot override the confirmed recipient or expose payment instructions.</p>
          {orderError && <p className="inline-warning" role="alert"><CircleAlert size={15}/>{orderError}</p>}
          <div className="order-list" aria-label="Payment orders">{orders.length === 0 ? <p className="fine-print">No persisted orders.</p> : orders.map(order => <div className="order-row" key={order.id}><div><strong>{order.id}</strong><small>{order.sourceAmountZat} zatoshis TAZ → {order.destinationAmountAtomic} atomic test USDC · expires {new Date(order.expiresAt).toLocaleString()}</small><small>{order.fixedRate.description}</small></div><span className="status-chip">{displayOrderStatus(order.status)}</span></div>)}</div>
          <p className="fine-print">Receipt verification is a separate, read-only coordinator operation. Uncertain observations become unresolved and are never retried or authorized for payout.</p>
        </section>
        <div className="footer"><span><BookOpen size={15}/> Engineering reference: Kawase patterns · Noir wallet adapter</span><span>No copied product UI or financial execution code</span></div>
      </main>
    </div>
  );
}
