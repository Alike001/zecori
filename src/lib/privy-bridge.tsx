import { createContext, useContext, type ReactNode } from 'react';

export type PrivyBridgeValue = {
  enabled: boolean;
  ready: boolean;
  authenticated: boolean;
  openLogin: () => void;
  getAccessToken: () => Promise<string | null>;
  logout: () => Promise<void>;
};

const disabled: PrivyBridgeValue = {
  enabled: false,
  ready: true,
  authenticated: false,
  openLogin: () => undefined,
  getAccessToken: async () => null,
  logout: async () => undefined,
};

const PrivyBridgeContext = createContext<PrivyBridgeValue>(disabled);

export function DisabledPrivyBridge({ children }: { children: ReactNode }) {
  return <PrivyBridgeContext.Provider value={disabled}>{children}</PrivyBridgeContext.Provider>;
}

export function PrivyBridgeProvider({ value, children }: { value: PrivyBridgeValue; children: ReactNode }) {
  return <PrivyBridgeContext.Provider value={value}>{children}</PrivyBridgeContext.Provider>;
}

export function usePrivyBridge() { return useContext(PrivyBridgeContext); }
