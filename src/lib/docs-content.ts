export type DocsPage = {
  slug: string;
  title: string;
  eyebrow: string;
  summary: string;
  featureIds: string[];
  sections: Array<{ title: string; body: string; bullets?: string[] }>;
};

export const DOCS_PAGES = Object.freeze([
  {
    slug: 'getting-started', title: 'Getting started', eyebrow: 'Start here',
    summary: 'Understand the one usable test route before connecting an identity or wallet.', featureIds: ['guest-exploration', 'fixed-test-route'],
    sections: [
      { title: 'What Zecori does', body: 'Zecori coordinates a shielded Zcash testnet source payment with a separately verified, publicly visible Base Sepolia test-USDC payout. It is a guarded test workflow using an experimental trusted liquidity provider—not a permissionless bridge or market exchange.' },
      { title: 'Safe first visit', body: 'Explore the route while signed out. Read the fixed terms, custody disclosure, refund limits, and route state before choosing a wallet.', bullets: ['Only 0.01 TAZ → 1 test USDC is executable.', 'Never send funds until an owner-scoped request publishes a validated receiver.', 'The app never asks for a seed phrase, viewing key, or private key.'] },
    ],
  },
  {
    slug: 'wallets-authentication', title: 'Wallets and authentication', eyebrow: 'Identity boundary',
    summary: 'Accounts protect history; wallets prove destination control. They are deliberately separate.', featureIds: ['passkey-auth', 'privy-auth', 'destination-proof'],
    sections: [
      { title: 'Passkeys', body: 'Passkeys are the verified account path. Add a second passkey while authenticated so one lost device does not strand the account.' },
      { title: 'Privy', body: 'Email and Google sign-in are integrated behind a disabled feature flag. Tokens are verified server-side and linked to internal UUID accounts only after explicit authenticated consent. No embedded wallet is created.' },
      { title: 'Wallet proof', body: 'A purpose-limited EIP-712 signature proves control of the exact Base Sepolia recipient. It does not authorize payment, payout, token transfer, or transaction signing.' },
    ],
  },
  {
    slug: 'swap-bridge', title: 'Swap and bridge', eyebrow: 'Guarded workflow',
    summary: 'Explore → configure → review → prove → request → track → receipt.', featureIds: ['fixed-test-route', 'destination-proof', 'order-lifecycle'],
    sections: [
      { title: 'Before payment', body: 'Creating a request does not create a payment address. Operator acceptance and durable allocation must occur before instructions can appear.' },
      { title: 'During settlement', body: 'Backend evidence—not browser optimism—moves the lifecycle through source detection, confirmation, payout review, submission, and independent verification.' },
      { title: 'Recovery', body: 'Failure, expiration, unresolved evidence, and refund review are explicit states. Do not resend funds based on chat text or a stale page.' },
    ],
  },
  {
    slug: 'route-availability', title: 'Route availability', eyebrow: 'Canonical registry',
    summary: 'Each route is explicitly executable, disabled, or research-only.', featureIds: ['fixed-test-route', 'live-quotes', 'mainnet'],
    sections: [
      { title: 'Fixed test route', body: 'The only implemented route uses Zcash testnet Ironwood and Base Sepolia. Its fixed outcome is not a live quote or liquidity promise.' },
      { title: 'Everything else', body: 'Mainnet is research-only. Additional testnet routes stay disabled until implementation, security review, wallet validation, and independent settlement evidence exist.' },
    ],
  },
  {
    slug: 'privacy-custody', title: 'Privacy and custody', eyebrow: 'Know the boundary',
    summary: 'Shielding reduces public-chain disclosure; it does not hide every service relationship.', featureIds: ['fixed-test-route', 'automated-settlement'],
    sections: [
      { title: 'What stays private', body: 'The Zcash source uses the Ironwood shielded pool. Private account history and destination data are owner-scoped, and stored settlement evidence is encrypted at rest. Public receipts redact source correlation.' },
      { title: 'What becomes public', body: 'The Base Sepolia destination transaction is transparent: recipient, token amount, and transaction hash are public on the destination chain. Identity, wallet, and RPC providers may also observe metadata.' },
      { title: 'Trusted LP custody', body: 'The experimental trusted liquidity provider and authorized verification services see evidence required for settlement. The LP temporarily controls received test funds. Payouts require separate approval and verification; refunds are manual and not guaranteed.' },
    ],
  },
  {
    slug: 'ai-and-voice', title: 'AI and voice', eyebrow: 'Advisory only',
    summary: 'Typed, policy-checked explanations and opt-in speech with no transaction authority.', featureIds: ['ai-limited', 'ai-groq', 'voice', 'live-quotes'],
    sections: [
      { title: 'Grounded cards', body: 'The gateway can return typed cards for route explanation, availability, quote unavailability, review preparation, owner-authorized status, and failure recovery.' },
      { title: 'Hard limits', body: 'The model cannot choose an unregistered route, invent a quote, create an order, access another account, sign, broadcast, approve a payout, or receive private wallet material.' },
      { title: 'Honest route examples', body: 'Useful questions include “Which route is available?”, “Explain the privacy boundary”, “Prepare the fixed-route review”, and—after sign-in—“What is the status of request <UUID>?”. The review card always says preview only, creates no order, authorizes no payment, and signs no transaction.' },
      { title: 'Speech privacy and retention', body: 'Recording is opt-in and authenticated. The browser asks for microphone permission only after the disclosure is accepted. Audio is bounded to 30 seconds and 2 MB, held in application memory, forwarded to Groq, zeroed after the response, and never written to application storage. Groq provider processing and abuse/reliability logging may still apply.' },
      { title: 'Provider support and fallbacks', body: 'Groq documentation currently lists whisper-large-v3-turbo for multilingual transcription, canopylabs/orpheus-v1-english for English output, and canopylabs/orpheus-arabic-saudi for Saudi Arabic output. French voice output is deliberately text-only. Account-specific availability and quota headers remain untested until a reviewer explicitly approves a live request.' },
      { title: 'Language matrix', body: 'English: UI partial, AI text supported, recognition configured, output configured. French: UI partial, AI text supported, recognition configured, text-only output. Arabic: UI partial with RTL, AI text supported, recognition configured, Saudi Arabic output configured. French and Arabic security warnings are machine-generated and cannot be called fully supported until human review.' },
      { title: 'Safe failure behavior', body: 'Unsupported routes, wrong amounts, invented prices, missing evidence, cross-account reads, prompt injection, malformed provider data, timeouts, rate limits, silence, and unavailable microphones stop without creating or authorizing a financial action.' },
    ],
  },
  {
    slug: 'receipts', title: 'Receipts', eyebrow: 'Verified evidence',
    summary: 'Receipts exist only after independent source and destination verification.', featureIds: ['receipts', 'order-lifecycle'],
    sections: [
      { title: 'Private receipt', body: 'The owner-only receipt contains verified settlement fields and remains behind the authenticated account boundary.' },
      { title: 'Shareable receipt', body: 'The public form excludes shielded source identifiers and private settlement evidence. It is a redacted research record, not a promise or cryptographic PDF.' },
    ],
  },
  {
    slug: 'order-recovery', title: 'Order recovery', eyebrow: 'Stop safely',
    summary: 'Recovery guidance follows authenticated backend state, never an invented success message.', featureIds: ['order-lifecycle', 'receipts'],
    sections: [
      { title: 'Access recovery', body: 'Use another registered passkey. Privy can become an additional explicit identity only after its release blockers clear.' },
      { title: 'Settlement recovery', body: 'FAILED, REFUND_PENDING, UNRESOLVED, EXPIRED, and CANCELLED each stop automatic progression. Keep the request ID and do not resend funds.' },
    ],
  },
  {
    slug: 'security', title: 'Security', eyebrow: 'Fail closed',
    summary: 'Public actions are narrow, private reads are owner-scoped, and financial execution stays operator-only.', featureIds: ['passkey-auth', 'privy-auth', 'destination-proof', 'automated-settlement'],
    sections: [
      { title: 'Browser and session', body: 'Exact origins, CSRF, HttpOnly sessions, request bounds, rate limits, passkey verification, and explicit destination proof protect the public edge.' },
      { title: 'Privy disposition', body: 'Privy stays disabled: no tenant credentials were supplied and its current React connector graph retains high-severity vulnerable Zod 3 copies. A forced Zod 4 override is unsupported.' },
      { title: 'Settlement separation', body: 'The public API exposes no operator mutations. Allocation, payout authorization, and evidence verification remain independently gated.' },
    ],
  },
  {
    slug: 'api-architecture', title: 'API and architecture', eyebrow: 'System map',
    summary: 'One public API, PostgreSQL authority, isolated verification, and a shared route registry.', featureIds: ['guest-exploration', 'order-lifecycle', 'ai-limited'],
    sections: [
      { title: 'Public boundary', body: '/api/v1 exposes capabilities, authentication, owner-scoped requests, destination challenges, receipts, and the advisory agent. Unsupported operations return 404.' },
      { title: 'Data authority', body: 'PostgreSQL owns users, sessions, requests, immutable manifests, encrypted evidence, identity links, receipts, and append-only audit history.' },
      { title: 'Capability truth', body: 'The frontend, API, docs, and assistant derive route and product claims from typed registries. Tests reject unknown statuses and fabricated live claims.' },
    ],
  },
  {
    slug: 'judge-walkthrough', title: 'Judge walkthrough', eyebrow: 'Five-minute path',
    summary: 'A five-minute path through what works—and what deliberately does not.', featureIds: ['guest-exploration', 'fixed-test-route', 'passkey-auth', 'ai-limited', 'receipts'],
    sections: [
      { title: '0:00–0:45 · Public truth', body: 'Start on the homepage. State “Your Zcash. More possibilities.” Show the shielded-source/transparent-destination disclosure and compare the exact supported test route with disabled research entries.' },
      { title: '0:45–2:15 · Guarded request', body: 'Open the route. Show the exact 0.01 TAZ → 1 test USDC terms, read-only checks, account boundary, destination confirmation, purpose-limited EIP-712 proof, and the explicit experimental trusted-LP custody warning.' },
      { title: '2:15–3:15 · Account and evidence', body: 'Use a disposable fixture account to show an honest empty ledger, a backend-owned lifecycle record, loading/error handling, and a branded verified receipt fixture. Never portray an unperformed settlement as complete.' },
      { title: '3:15–4:15 · Advisory assistant', body: 'Ask “Which route is available?” and “Prepare the route review.” Show deterministic typed cards, then ask for a live quote or payout approval and show the safe refusal. Describe live Groq and voice as untested, not demonstrated.' },
      { title: '4:15–5:00 · Limits and next gate', body: 'Open the evidence matrix. Point out Privy, mainnet, live quotes, automatic settlement/refunds, ERC-1271, inbox, handles, email, and settings as disabled or planned. Finish with the separately approved first shielded testnet settlement as the next human-controlled gate.' },
    ],
  },
  {
    slug: 'evidence', title: 'Evidence', eyebrow: 'Review record',
    summary: 'Actual checks, known skips, and the feature truth matrix.', featureIds: ['guest-exploration', 'passkey-auth', 'fixed-test-route', 'destination-proof', 'order-lifecycle', 'receipts', 'ai-limited', 'privy-auth'],
    sections: [
      { title: 'Automated evidence', body: 'The review report records disposable migrations, unit/API/PostgreSQL tests, browser and WebAuthn smoke, accessibility checks, typecheck, build, privacy/security scans, and dependency audit results.' },
      { title: 'Not tested live', body: 'Real Privy identities, durable staging, real wallets, live-chain source detection, funded orders, allocations, payouts, mainnet, live Groq chat/speech, physical microphones, English/Arabic pronunciation, email, handles, and inbox delivery remain outside this review.' },
    ],
  },
  {
    slug: 'roadmap', title: 'Roadmap', eyebrow: 'Future, not shipped',
    summary: 'Evidence-based VERIFIED, EXPERIMENTAL, DISABLED, and PLANNED badges separate working code from future work.', featureIds: ['ai-limited', 'voice', 'privy-auth', 'handles', 'inbox', 'email-notifications', 'settings', 'mainnet'],
    sections: [
      { title: 'Verified now', body: 'Guest exploration, passkey accounts, deterministic route answers, owner-scoped lifecycle state, and redacted receipts have automated evidence.' },
      { title: 'Experimental', body: 'The fixed test route, destination proof, Groq chat adapter, and speech gateway exist in code but retain explicit live or human acceptance work. Zecori is adopted provisionally as the customer-facing name; legal clearance remains open.' },
      { title: 'Disabled', body: 'Privy, live quotes, automatic settlement/refunds, and mainnet stay off. Privy remains blocked by unresolved dependency advisories; no unsupported Zod override is permitted.' },
      { title: 'Planned', body: 'Handles, contacts, inbox, opt-in email, and settings remain design work without active service endpoints.' },
      { title: 'Next evidence gates', body: 'Human-review French and Arabic security warnings; approve and run provider model/quota checks; validate real microphone and pronunciation behavior; resolve Privy advisories; then conduct the first separately approved linked Zcash-to-Base testnet settlement.' },
    ],
  },
  {
    slug: 'brand-system', title: 'Zecori brand system', eyebrow: 'Adopted provisionally',
    summary: 'A route/origin identity for shielded-source coordination, adopted for the product while legal clearance remains open.', featureIds: ['brand-exploration'],
    sections: [
      { title: 'Name and tagline', body: 'Zecori is the provisional customer-facing product name. The tagline is “Your Zcash. More possibilities.” Repository directory, package identifiers, environment-variable prefixes, and database names remain unchanged for compatibility and provenance.' },
      { title: 'Mark meaning', body: 'A concealed circular origin meets a vertical privacy boundary, then becomes a split route ending in two public evidence points. The mark avoids generic Z, shield, and chain-link motifs and makes no claim of trustlessness.' },
      { title: 'Palette and motion', body: 'Sprout and evidence-teal carry route state against accessible moss neutrals in dark and light themes. Motion is limited to state and navigation transitions and is removed when reduced motion is requested.' },
      { title: 'Naming gate', body: 'Provisional adoption is not trademark or domain clearance. Before external launch, search exact and phonetic variants in relevant registries, companies, app stores, social handles, and domains, then document jurisdiction and confusion risk.' },
    ],
  },
] satisfies readonly DocsPage[]);

export function docsPage(slug: string): DocsPage | undefined {
  return DOCS_PAGES.find(page => page.slug === slug);
}
