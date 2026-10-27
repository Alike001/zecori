import type { ReactNode } from 'react';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { PrivyBridgeProvider } from './privy-bridge.tsx';

function Bridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  return <PrivyBridgeProvider value={{ enabled: true, ready, authenticated, openLogin: login, getAccessToken, logout }}>{children}</PrivyBridgeProvider>;
}

export function ConfiguredPrivy({ appId, children }: { appId: string; children: ReactNode }) {
  return <PrivyProvider appId={appId} config={{
    loginMethods: ['email', 'google'],
    embeddedWallets: { ethereum: { createOnLogin: 'off' }, solana: { createOnLogin: 'off' }, showWalletUIs: false },
    appearance: { theme: 'dark', accentColor: '#e8ff59' },
  }}><Bridge>{children}</Bridge></PrivyProvider>;
}
