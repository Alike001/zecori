import type { ComponentType } from 'react';
import type { MDXProps } from 'mdx/types.js';
import GettingStarted, { meta as gettingStarted } from './pages/getting-started.mdx';
import WalletsAuthentication, { meta as walletsAuthentication } from './pages/wallets-authentication.mdx';
import NoirWallet, { meta as noirWallet } from './pages/noir-wallet.mdx';
import SwapBridge, { meta as swapBridge } from './pages/swap-bridge.mdx';
import RouteAvailability, { meta as routeAvailability } from './pages/route-availability.mdx';
import PrivacyCustody, { meta as privacyCustody } from './pages/privacy-custody.mdx';
import HandlesContacts, { meta as handlesContacts } from './pages/handles-contacts.mdx';
import InboxNotifications, { meta as inboxNotifications } from './pages/inbox-notifications.mdx';
import AiVoice, { meta as aiVoice } from './pages/ai-and-voice.mdx';
import Receipts, { meta as receipts } from './pages/receipts.mdx';
import OrderRecovery, { meta as orderRecovery } from './pages/order-recovery.mdx';
import Security, { meta as security } from './pages/security.mdx';
import ApiArchitecture, { meta as apiArchitecture } from './pages/api-architecture.mdx';
import JudgeWalkthrough, { meta as judgeWalkthrough } from './pages/judge-walkthrough.mdx';
import Evidence, { meta as evidence } from './pages/evidence.mdx';
import Roadmap, { meta as roadmap } from './pages/roadmap.mdx';
import BrandSystem, { meta as brandSystem } from './pages/brand-system.mdx';

export type DocsPage = typeof gettingStarted & { Component: ComponentType<MDXProps> };

export const DOCS_PAGES: readonly DocsPage[] = Object.freeze([
  { ...gettingStarted, Component: GettingStarted },
  { ...walletsAuthentication, Component: WalletsAuthentication },
  { ...noirWallet, Component: NoirWallet },
  { ...swapBridge, Component: SwapBridge },
  { ...routeAvailability, Component: RouteAvailability },
  { ...privacyCustody, Component: PrivacyCustody },
  { ...handlesContacts, Component: HandlesContacts },
  { ...inboxNotifications, Component: InboxNotifications },
  { ...aiVoice, Component: AiVoice },
  { ...receipts, Component: Receipts },
  { ...orderRecovery, Component: OrderRecovery },
  { ...security, Component: Security },
  { ...apiArchitecture, Component: ApiArchitecture },
  { ...judgeWalkthrough, Component: JudgeWalkthrough },
  { ...evidence, Component: Evidence },
  { ...roadmap, Component: Roadmap },
  { ...brandSystem, Component: BrandSystem },
]);

export function docsPage(slug: string): DocsPage | undefined {
  return DOCS_PAGES.find(page => page.slug === slug);
}
