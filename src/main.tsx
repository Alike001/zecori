import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { DisabledPrivyBridge } from './lib/privy-bridge.tsx';
import './styles.css';

type BootstrapCapabilities = { authentication?: { privy?: { enabled: boolean; appId?: string } } };
declare const __PRIVY_UI_COMPILED__: boolean;

async function bootstrap() {
  let appId: string | undefined;
  try {
    const response = await fetch('/api/v1/capabilities', { credentials: 'same-origin' });
    if (response.ok) {
      const capabilities = await response.json() as BootstrapCapabilities;
      if (capabilities.authentication?.privy?.enabled) appId = capabilities.authentication.privy.appId;
    }
  } catch { /* Guest and passkey flows remain available when bootstrap cannot reach the API. */ }
  const configuredApp = appId && __PRIVY_UI_COMPILED__
    ? await import('./lib/privy-enabled.tsx').then(({ ConfiguredPrivy }) => <ConfiguredPrivy appId={appId}><App/></ConfiguredPrivy>)
    : <DisabledPrivyBridge><App/></DisabledPrivyBridge>;
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{configuredApp}</React.StrictMode>);
}

void bootstrap();
