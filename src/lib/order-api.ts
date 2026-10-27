import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type { AgentFactCard } from './agent-cards.ts';
export type { AgentFactCard } from './agent-cards.ts';

export type PublicRouteTerms = {
  source: { network: 'zcash-testnet'; asset: 'TAZ'; pool: 'ironwood'; amountZatoshis: '1000000'; amount: '0.01'; confirmations: 10 };
  destination: { network: 'base-sepolia'; chainId: 84532; asset: 'USDC'; contract: string; amountAtomic: '1000000'; amount: '1'; confirmations: 3 };
  provider: { id: string; model: 'trusted-liquidity-provider' };
  rate: { description: string };
  custody: string;
  refunds: string;
};

export type PublicOrderRequest = {
  id: string;
  status: 'AWAITING_OPERATOR' | 'ACCEPTED' | 'PAYMENT_READY' | 'SOURCE_DETECTED' | 'SOURCE_CONFIRMED' | 'PAYOUT_AWAITING_APPROVAL' | 'PAYOUT_SUBMITTED' | 'COMPLETED' | 'FAILED' | 'REFUND_PENDING' | 'REFUNDED' | 'UNRESOLVED' | 'EXPIRED' | 'CANCELLED';
  createdAt: string;
  expiresAt: string;
  destinationBinding: { status: 'confirmed' | 'bound' | 'expired' | 'revoked' | 'legacy-unverified'; consentConfirmedAt?: string; walletControlVerification: 'unverified' | 'verified-eoa' | 'verified-erc1271'; verifiedAt?: string };
  terms: PublicRouteTerms;
  destinationReview?: { recipient: string; network: 'base-sepolia'; chainId: 84532; asset: 'USDC'; contract: string; amountAtomic: '1000000' };
  linkedOrderId?: string;
  paymentInstructions?: { receiver: string; expiresAt: string };
  order?: { finalReceiptId?: string; resolutionReason?: string };
  timeline?: Array<{ type: string; at: string; actor: string; details: Record<string, unknown> }>;
};

export type PrivateReceipt = {
  receiptId: string;
  kind: 'final';
  orderId: string;
  sourceChain: 'zcash-testnet';
  destinationChain: 'base-sepolia';
  sourceAsset: 'TAZ';
  destinationAsset: 'USDC';
  verifiedSourceAmount: string;
  verifiedDestinationAmount: string;
  actualKnownFees: Array<{ asset: string; amount: string }>;
  sourceSettlementTimestamp: string;
  destinationSettlementTimestamp: string;
  destinationTransactionHash: string;
  sourceTransactionId: string;
  verificationStatus: 'independently-verified';
  privacyClassification: string;
  printableNotice: string;
};

export type PublicCapabilities = {
  apiVersion: 'v1';
  execution: 'operator-approved-testnet-only';
  routeId: 'zcash-testnet-to-base-sepolia-fixed';
  classification: 'fixed-test-terms';
  route: PublicRouteTerms;
  routes: import('./route-capabilities.ts').RouteCapability[];
  productCapabilities: import('./product-capabilities.ts').ProductCapability[];
  authentication: { passkeys: true; guestExploration: true; privy: { enabled: boolean; appId?: string; loginMethods?: string[]; embeddedWalletCreation?: false; delegatedActions?: false; serverSigning?: false } };
  orderCreation: { enabled: boolean; state: 'operator-attested-ready'|'operator-review-required'; reason: string; binding: 'encrypted-owner-scoped-v2'; walletControlVerification: 'required-eip712-eoa'|'required-eip712-or-erc1271' };
  wallets: {
    zcash: { network: 'zcash-testnet'; pool: 'ironwood'; connectedMode: 'read-only-capability-check'; externalMode: true };
    base: { network: 'base-sepolia'; chainId: 84532; contract: string; connectedMode: 'user-initiated-eip712'; manualRecipient: true; addressIntentConfirmation: true; walletControlVerified: true; supportedProofs: string[] };
  };
  agent: { mode: 'model-backed' | 'limited'; provider?: string; model?: string; reason?: string; externalRequestsApproved: boolean; limits: { maxOutputTokens: number; maxProviderCalls: number }; dataHandling?: { responseStorageControl: 'request-disabled' | 'provider-default'; retentionNotice: string } };
  voice: {
    enabled: boolean; provider: 'groq'; reason?: string; externalRequestsApproved: boolean; liveValidated: boolean;
    transcription: { model: 'whisper-large-v3-turbo'; locales: readonly ['en','fr','ar']; providerDocumentationVerified: true };
    synthesis: { locales: readonly ['en','ar']; models: { en: 'canopylabs/orpheus-v1-english'; ar: 'canopylabs/orpheus-arabic-saudi' }; providerDocumentationVerified: true };
    limits: { maximumAudioBytes: number; maximumDurationMs: number; minimumDurationMs: number; maximumSpeechCharacters: number };
    retention: 'memory-only-until-provider-response';
  };
  social: { handles: true; privateContacts: true; handleRequestIntents: true; paymentByHandle: false; publicDirectory: false };
  notifications: { inApp: true; transactionalOutbox: true; externalChannels: false };
};

export type AgentReply = {
  text: string;
  mode: 'model-backed' | 'limited';
  provider?: string;
  toolsUsed: string[];
  providerCalls: number;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  providerRateLimits?: { limitRequests?: string; remainingRequests?: string; limitTokens?: string; remainingTokens?: string; resetRequests?: string; resetTokens?: string };
  refusal?: true;
  failureCode?: 'input-policy' | 'provider-response' | 'provider-rate-limit' | 'provider-timeout' | 'tool-authorization' | 'tool-output-boundary' | 'model-output-rejected' | 'provider-call-limit';
  retryAfterSeconds?: number;
  publicRouteDiagnostic?: { failedRule: string; extractedFacts: { tazAmounts: string[]; usdcAmounts: string[]; exactFixedPricing: boolean; routeId?: string; routeIds: string[]; providerIds: string[]; destinationChainIds: string[]; mentionsBaseSepolia: boolean; statesNoLiveMarketQuote: boolean; statesNoSpendingAuthority: boolean; unsupportedNetworkClaims: string[] }; sanitizedModelResponse: string };
  factCards?: AgentFactCard[];
};

let csrfToken: string | undefined;

export type UserSession = { authenticated: boolean; user?: { id: string; displayName: string; passkeyCount: number }; csrfToken?: string };

async function parse<T>(response: Response): Promise<T> {
  const value = await response.json() as T & { error?: string | { message?: string } };
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : value.error?.message ?? 'Request failed');
  return value;
}

async function csrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const session = await getSession();
  if (!session.authenticated || !session.csrfToken) throw new Error('Passkey authentication is required');
  csrfToken = session.csrfToken;
  return csrfToken;
}

export async function getSession(): Promise<UserSession> {
  const session = await parse<UserSession>(await fetch('/api/v1/session', { credentials: 'same-origin' }));
  csrfToken = session.csrfToken;
  return session;
}

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  return parse<T>(await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) }, body: JSON.stringify(body) }));
}

async function mutate<T>(method: 'PUT'|'PATCH'|'DELETE', path: string, body: unknown): Promise<T> {
  return parse<T>(await fetch(path,{method,credentials:'same-origin',headers:{'content-type':'application/json','x-csrf-token':await csrf()},body:JSON.stringify(body)}));
}

export type AccountHandle={handleId:string;handle:string;normalizedHandle:string;status:'ACTIVE'|'LOCKED'|'RETIRED';discoverable:boolean;version:number;claimedAt:string;updatedAt:string;renameAvailableAt?:string};
export type PrivateContact={contactId:string;handle:string;label:string;status:'ACTIVE';updatedAt:string};
export type HandleRequestIntent={intentId:string;direction:'incoming'|'outgoing';counterpartyHandle:string;routeId:'zcash-testnet-to-base-sepolia-fixed';status:'REQUESTED'|'ACCEPTED'|'DECLINED'|'CANCELLED'|'EXPIRED';createdAt:string;expiresAt:string};
export type InboxItem={inboxItemId:string;category:'ORDER'|'HANDLE'|'REQUEST';titleKey:string;bodyVariables:Record<string,string>;requestId?:string;createdAt:string;read:boolean};
export type InboxPage={items:InboxItem[];unreadCount:number;nextCursor?:string};
export async function getAccountHandle(){return(await parse<{handle?:AccountHandle}>(await fetch('/api/v1/account/handle',{credentials:'same-origin'}))).handle}
export async function checkHandleAvailability(candidate:string){return post<{available:boolean}>('/api/v1/handles/availability',{candidate},await csrf())}
export async function saveAccountHandle(candidate:string,expectedVersion:number,confirmation:string){return(await mutate<{handle:AccountHandle}>('PUT','/api/v1/account/handle',{candidate,expectedVersion,confirmation})).handle}
export async function setHandleDiscoverability(discoverable:boolean,expectedVersion:number,confirmation:string){return(await mutate<{handle:AccountHandle}>('PATCH','/api/v1/account/handle/discoverability',{discoverable,expectedVersion,confirmation})).handle}
export async function listContacts(){return(await parse<{contacts:PrivateContact[]}>(await fetch('/api/v1/contacts',{credentials:'same-origin'}))).contacts}
export async function addContact(handle:string,label:string){return(await post<{contact:PrivateContact}>('/api/v1/contacts',{handle,label},await csrf())).contact}
export async function removeContact(contactId:string){await mutate('DELETE',`/api/v1/contacts/${encodeURIComponent(contactId)}`,{})}
export async function listHandleRequests(){return(await parse<{requests:HandleRequestIntent[]}>(await fetch('/api/v1/handle-requests',{credentials:'same-origin'}))).requests}
export async function createHandleRequest(contactId:string){return(await post<{request:HandleRequestIntent}>('/api/v1/handle-requests',{contactId,confirmation:'REQUEST FIXED TEST ROUTE'},await csrf())).request}
export async function respondHandleRequest(intentId:string,action:'ACCEPT'|'DECLINE'){return(await post<{request:HandleRequestIntent}>(`/api/v1/handle-requests/${encodeURIComponent(intentId)}/respond`,{action,confirmation:action==='ACCEPT'?'ACCEPT REQUEST — NO PAYMENT':'DECLINE REQUEST'},await csrf())).request}
export async function getInbox(filters:{unreadOnly?:boolean;category?:string}={}){const query=new URLSearchParams();if(filters.unreadOnly)query.set('unread','1');if(filters.category)query.set('category',filters.category);return parse<InboxPage>(await fetch(`/api/v1/inbox${query.size?`?${query}`:''}`,{credentials:'same-origin'}))}
export async function setInboxItemRead(id:string,read:boolean){await post(`/api/v1/inbox/${encodeURIComponent(id)}/${read?'read':'unread'}`,{},await csrf())}
export async function markAllInboxRead(){return post<{updated:number}>('/api/v1/inbox/read-all',{},await csrf())}

export async function registerPasskey(displayName: string, passkeyLabel: string, adding = false): Promise<void> {
  const token = adding ? await csrf() : undefined;
  const ceremony = await post<{ challengeId: string; passkeyLabel: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>('/api/v1/auth/register/options', { displayName, passkeyLabel }, token);
  const response = await startRegistration({ optionsJSON: ceremony.options });
  await post('/api/v1/auth/register/verify', { challengeId: ceremony.challengeId, passkeyLabel: ceremony.passkeyLabel, response }, token);
  csrfToken = undefined;
}

export async function loginWithPasskey(): Promise<void> {
  const ceremony = await post<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>('/api/v1/auth/login/options', {});
  const response = await startAuthentication({ optionsJSON: ceremony.options });
  await post('/api/v1/auth/login/verify', { challengeId: ceremony.challengeId, response });
  csrfToken = undefined;
}

export async function logout(): Promise<void> {
  await post('/api/v1/auth/logout', {}, await csrf()); csrfToken = undefined;
}

export async function loginWithPrivy(accessToken: string): Promise<void> {
  await postWithBearer('/api/v1/auth/privy/login', accessToken);
  csrfToken = undefined;
}

export async function linkPrivy(accessToken: string): Promise<{ linked: true; alreadyLinked: boolean }> {
  return postWithBearer('/api/v1/auth/privy/link', accessToken, await csrf());
}

async function postWithBearer<T>(path: string, accessToken: string, token?: string): Promise<T> {
  return parse<T>(await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}`, ...(token ? { 'x-csrf-token': token } : {}) }, body: '{}' }));
}

export async function getCapabilities(): Promise<PublicCapabilities> {
  return parse(await fetch('/api/v1/capabilities', { credentials: 'same-origin' }));
}

export async function listOrderRequests(): Promise<PublicOrderRequest[]> {
  return (await parse<{ requests: PublicOrderRequest[] }>(await fetch('/api/v1/order-requests', { credentials: 'same-origin' }))).requests;
}

export type WalletReadinessIntent = {
  routeId: 'zcash-testnet-to-base-sepolia-fixed'; amountZatoshis: '1000000'; termsAccepted: true;
  source: { mode: 'connected-read-only' | 'external'; network: 'zcash-testnet'; pool: 'ironwood' };
  destination: { mode: 'connected-read-only' | 'manual'; network: 'base-sepolia'; chainId: 84532; contract: string; address: string };
  destinationConsent: { version: 'base-destination-intent-v1'; statement: 'I confirm this exact Base Sepolia address is the intended USDC recipient. This records my intent and does not prove that I control the wallet.'; confirmed: true };
};

export async function createOrderRequest(intent: WalletReadinessIntent): Promise<PublicOrderRequest> {
  const token = await csrf();
  return (await parse<{ request: PublicOrderRequest }>(await fetch('/api/v1/order-requests', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': token }, body: JSON.stringify(intent),
  }))).request;
}

export type DestinationControlChallenge = { challengeId: string; requestId: string; intentId: string; recipient: string; expiresAt: string; typedData: Record<string, unknown> };
export async function issueDestinationChallenge(requestId: string): Promise<DestinationControlChallenge> {
  return (await post<{ challenge: DestinationControlChallenge }>(`/api/v1/order-requests/${encodeURIComponent(requestId)}/destination-challenges`, {}, await csrf())).challenge;
}
export async function verifyDestinationChallenge(challengeId: string, signature: string): Promise<void> {
  await post(`/api/v1/destination-challenges/${encodeURIComponent(challengeId)}/verify`, { signature }, await csrf());
}

export async function getOrderRequest(id: string): Promise<PublicOrderRequest> {
  return (await parse<{ request: PublicOrderRequest }>(await fetch(`/api/v1/order-requests/${encodeURIComponent(id)}`, { credentials: 'same-origin' }))).request;
}

export async function getPrivateReceipt(receiptId: string): Promise<PrivateReceipt> {
  return (await parse<{ receipt: PrivateReceipt }>(await fetch(`/api/v1/receipts/${encodeURIComponent(receiptId)}/private`, { credentials: 'same-origin' }))).receipt;
}

export async function sendAgentMessage(message: string, locale: 'en' | 'fr' | 'ar'): Promise<AgentReply> {
  return (await parse<{ reply: AgentReply }>(await fetch('/api/v1/agent/messages', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) },
    body: JSON.stringify({ message, locale }),
  }))).reply;
}

export async function transcribeVoice(audio: Blob, durationMs: number, locale: 'en' | 'fr' | 'ar'): Promise<string> {
  const response = await fetch('/api/v1/voice/transcriptions', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': audio.type || 'audio/webm', 'x-csrf-token': await csrf(), 'x-voice-consent': 'audio-processing-and-retention-accepted', 'x-speech-locale': locale, 'x-audio-duration-ms': String(Math.round(durationMs)) },
    body: audio,
  });
  return (await parse<{ transcript: string; canAuthorizePayment: false }>(response)).transcript;
}

export async function synthesizeVoice(text: string, locale: 'en' | 'ar'): Promise<Blob> {
  const response = await fetch('/api/v1/voice/speech', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': await csrf(), 'x-voice-consent': 'audio-processing-and-retention-accepted' },
    body: JSON.stringify({ text, locale }),
  });
  if (!response.ok) {
    const value = await response.json() as { error?: { message?: string } };
    throw new Error(value.error?.message ?? 'Voice output failed');
  }
  return response.blob();
}
