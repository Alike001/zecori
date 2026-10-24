#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { FileOrderStore } from '../server/order-api.ts';
import { executeAuthorizedAddressAllocation, executeAuthorizedPayoutApproval } from '../server/operator-actions.ts';
import { defaultOperatorControlPath, defaultOperatorKeyPath, inspectOperatorKey, OperatorControlStore } from '../server/operator-control.ts';
import { checkBaseHealth, checkLiquidity, checkZcashHealth, previewTerms, runOperatorPreflight } from '../server/operator-preflight.ts';
import { createOperatorConfig, defaultOperatorConfigPath, inspectOperatorConfig, loadOperatorConfig, validateOperatorAddresses } from '../server/operator-config.ts';
import { createOperatorOrderBinding } from '../src/lib/operator-order.ts';
import { checkSourceWalletA } from '../server/zcash-source-wallet.ts';
import { createSourceWalletConfig, defaultSourceWalletConfigPath, inspectSourceWalletConfig } from '../server/zcash-source-config.ts';

function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : 'Operator command failed';
  process.stderr.write(`Operator command refused: ${message}\n`);
  process.exitCode = 1;
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

process.stderr.write('Legacy JSON operator mutations are disabled. Use `pnpm operator -- help` for the PostgreSQL settlement CLI. Existing JSON files were not changed.\n');
process.exit(2);

function argumentsMap(values: string[]): { command?: string; options: Record<string, string> } {
  const [command, ...rest] = values; const options: Record<string, string> = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]; const value = rest[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Expected --name value, received ${key ?? 'nothing'}`);
    options[key.slice(2)] = value;
  }
  return { command, options };
}

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function requireInteractiveConfirmation(actual: string | undefined, expected: string): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Authorization commands require an interactive operator terminal');
  if (actual !== expected) throw new Error(`Explicit confirmation must exactly equal: ${expected}`);
}

function requireInteractiveTerminal(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('This command requires an interactive operator terminal');
}

async function prompt(label: string): Promise<string> {
  const terminal = createInterface({ input: stdin, output: stdout });
  try { return (await terminal.question(label)).trim(); } finally { terminal.close(); }
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function masked(value: string): string { return `${value.slice(0, 8)}…${value.slice(-6)}`; }
function print(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

const cliArguments = process.argv.slice(2);
if (cliArguments[0] === '--') cliArguments.shift();
const { command = 'help', options } = argumentsMap(cliArguments);
const orders = new FileOrderStore(); const controls = new OperatorControlStore();

async function configuredAddresses(): Promise<{ lpAddress?: string; recipient?: string; confirmedRecipient?: string }> {
  let stored: Awaited<ReturnType<typeof loadOperatorConfig>> | undefined;
  try { stored = await loadOperatorConfig(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    lpAddress: options['lp-address'] ?? process.env.ZECATHON_LP_BASE_ADDRESS ?? stored?.lpSender,
    recipient: options.recipient ?? process.env.ZECATHON_BASE_RECIPIENT ?? stored?.usdcReceiver,
    confirmedRecipient: options['confirm-recipient'] ?? process.env.ZECATHON_CONFIRMED_BASE_RECIPIENT ?? stored?.usdcReceiver,
  };
}

switch (command) {
  case 'configure': {
    requireInteractiveTerminal();
    if (await exists(defaultOperatorConfigPath())) throw new Error('Operator configuration already exists and will not be overwritten');
    const lpSender = await prompt('LP Sender full public Base Sepolia address from MetaMask: ');
    const usdcReceiver = await prompt('USDC Receiver full public Base Sepolia address from MetaMask: ');
    validateOperatorAddresses(lpSender, usdcReceiver);
    const network = await prompt('With MetaMask showing Base Sepolia, type BASE SEPOLIA 84532: ');
    if (network !== 'BASE SEPOLIA 84532') throw new Error('Base Sepolia network confirmation did not match');
    await createOperatorConfig({ lpSender, usdcReceiver });
    print({ stage: 'ACCOUNTS_CONFIGURED', network: 'base-sepolia', chainId: 84532, lpSender: masked(lpSender), usdcReceiver: masked(usdcReceiver), configurationStored: true });
    break;
  }
  case 'bootstrap': {
    requireInteractiveTerminal();
    await loadOperatorConfig();
    const confirmation = await prompt('Type INITIALIZE PRIVATE OPERATOR STORAGE to continue: ');
    if (confirmation !== 'INITIALIZE PRIVATE OPERATOR STORAGE') throw new Error('Explicit bootstrap confirmation did not match');
    const orderExists = await exists(orders.databasePath());
    const controlExists = await exists(defaultOperatorControlPath());
    const keyExists = await exists(defaultOperatorKeyPath());
    if (!orderExists) await orders.initialize();
    else await orders.operatorSnapshot();
    if (!controlExists) await controls.initialize();
    else {
      const health = await controls.health();
      if (!health.ready) throw new Error(health.reason ?? 'Operator control database is not ready');
    }
    if (!keyExists) await controls.provisionKey();
    const key = await inspectOperatorKey();
    if (!key.ready) throw new Error(key.reason ?? 'Operator authorization key is not ready');
    print({ stage: 'PRIVATE_STORAGE_INITIALIZED', orderDatabase: orderExists ? 'preserved' : 'initialized', controlDatabase: controlExists ? 'preserved' : 'initialized', operatorAuthorizationKey: keyExists ? 'preserved' : 'provisioned', secretDisplayed: false });
    break;
  }
  case 'status': {
    const config = await inspectOperatorConfig();
    const key = await inspectOperatorKey();
    const orderDatabase = await exists(orders.databasePath());
    const controlDatabase = await controls.health();
    print({ configuration: config, sourceWalletConfiguration: await inspectSourceWalletConfig(), orderDatabaseInitialized: orderDatabase, controlDatabase, operatorAuthorizationKey: key });
    break;
  }
  case 'configure-source-wallet': {
    requireInteractiveTerminal();
    if (await exists(defaultSourceWalletConfigPath())) throw new Error('Wallet A configuration already exists and will not be overwritten');
    requireInteractiveConfirmation(options.confirm, 'CONFIGURE EXISTING TESTNET WALLET A');
    await createSourceWalletConfig({ rpcUrl: required(options.rpc, 'Wallet A RPC URL'), dataDir: required(options['data-dir'], 'Wallet A data directory') });
    print({ stage: 'SOURCE_WALLET_CONFIGURED', network: 'zcash-testnet', rpc: '127.0.0.1:18392', existingWalletOnly: true, walletStarted: false, cookieStored: false, secretsDisplayed: false });
    break;
  }
  case 'wallet-health': print(await checkZcashHealth()); break;
  case 'source-wallet': print(await checkSourceWalletA()); break;
  case 'base-health': print(await checkBaseHealth()); break;
  case 'balances': {
    const { lpAddress } = await configuredAddresses();
    const address = required(lpAddress, 'Operator-confirmed LP Base address');
    print({ lpAddress: masked(address), ...(await checkLiquidity(address)) }); break;
  }
  case 'orders': {
    const snapshot = await orders.operatorSnapshot();
    print({
      orders: snapshot.orders.map(order => ({ ...order, id: masked(order.id) })),
      preparedOrders: (await orders.preparedOrderSnapshot()).map(order => ({ ...order, orderId: masked(order.orderId) })),
      allocationCounts: snapshot.allocationCounts, replayReferenceCount: snapshot.replayReferenceCount,
      unresolvedOperations: (await controls.inspect()).allocations.filter(item => item.state !== 'RESERVED').map(item => ({ allocationId: masked(item.allocationId), state: item.state })),
    }); break;
  }
  case 'prepare-order': {
    const operator = required(options.operator ?? process.env.ZECATHON_OPERATOR_ID, 'Operator ID');
    requireInteractiveConfirmation(options.confirm, 'PREPARE UNIQUE TESTNET ORDER');
    const { recipient, confirmedRecipient } = await configuredAddresses();
    const destinationRecipient = required(recipient, 'Operator-confirmed Base recipient');
    if (destinationRecipient.toLowerCase() !== required(confirmedRecipient, 'Confirmed Base recipient').toLowerCase()) throw new Error('Recipient confirmation does not match');
    const expiryMinutes = Number(options['expiry-minutes'] ?? '30');
    if (!Number.isSafeInteger(expiryMinutes) || expiryMinutes < 10 || expiryMinutes > 1440) throw new Error('Expiry must be between 10 and 1440 minutes');
    const now = Date.now();
    const binding = createOperatorOrderBinding({ orderId: randomUUID(), destinationRecipient, expiresAt: new Date(now + expiryMinutes * 60_000).toISOString(), providerId: options.provider, now });
    const signature = await controls.signOrderManifest(binding, operator);
    await orders.prepareOperatorOrder(binding, operator, signature, now);
    print({ stage: 'ORDER_PREPARED', orderId: binding.orderId, providerId: binding.providerId, sourceAmountZat: binding.sourceAmountZat, destinationAmountAtomic: binding.destinationAmountAtomic, destinationRecipient: masked(binding.destinationRecipient), expiresAt: binding.expiresAt, active: false, paymentInstructionsExposed: false });
    break;
  }
  case 'preview': {
    const { recipient, confirmedRecipient } = await configuredAddresses();
    const address = required(recipient, 'Base recipient');
    if (address.toLowerCase() !== required(confirmedRecipient, 'Confirmed Base recipient').toLowerCase()) throw new Error('Recipient confirmation does not match');
    print(previewTerms(address, Date.now(), Number(options['expiry-minutes'] ?? '30'))); break;
  }
  case 'preflight':
  case 'readiness': {
    const { lpAddress, recipient, confirmedRecipient } = await configuredAddresses();
    const result = await runOperatorPreflight({ lpAddress, recipient, confirmedRecipient, orders, controls, requireFreshAllocation: command === 'preflight' });
    print(result);
    if (command === 'preflight' ? !result.readyForFirstPayment : !result.operatorConfigured) process.exitCode = 2;
    break;
  }
  case 'authorize-address': {
    const operatorId = options.operator ?? process.env.ZECATHON_OPERATOR_ID;
    const operator = required(operatorId, 'Operator ID');
    const orderId = required(options.order, 'Prepared order ID');
    requireInteractiveConfirmation(options.confirm, 'AUTHORIZE FRESH ORCHARD ADDRESS');
    const prepared = await orders.operatorOrderManifest(orderId);
    if (prepared.operatorId !== operator) throw new Error('Operator identity does not match the prepared order');
    await controls.verifyOrderManifest(prepared.binding, operator, prepared.manifestSignature);
    if (prepared.state !== 'PREPARED') throw new Error('Operator order is not awaiting address authorization');
    const id = await controls.authorize({ action: 'ADDRESS_ALLOCATION', target: `order:${orderId}`, operatorId: operator, orderBinding: prepared.binding, diversifierIndex: options['diversifier-index'] });
    print({ authorizationId: id, action: 'ADDRESS_ALLOCATION', orderId, executionPerformed: false }); break;
  }
  case 'recover-address': {
    const operatorId = options.operator ?? process.env.ZECATHON_OPERATOR_ID;
    const operator = required(operatorId, 'Operator ID');
    requireInteractiveConfirmation(options.confirm, 'EXECUTE AUTHORIZED ADDRESS ALLOCATION');
    const orderId = required(options.order, 'Prepared order ID');
    const allocationId = await executeAuthorizedAddressAllocation({ authorizationId: required(options.authorization, 'Authorization ID'), orderId, operatorId: operator, controls, orders });
    print({ orderId, allocationId, state: 'RESERVED_FOR_ORDER', paymentInstructionsExposed: false }); break;
  }
  case 'activate-order': {
    const operator = required(options.operator ?? process.env.ZECATHON_OPERATOR_ID, 'Operator ID');
    const orderId = required(options.order, 'Prepared order ID');
    requireInteractiveConfirmation(options.confirm, 'ACTIVATE TESTNET PAYMENT INSTRUCTIONS');
    const prepared = await orders.operatorOrderManifest(orderId);
    if (prepared.operatorId !== operator) throw new Error('Operator identity does not match the prepared order');
    await controls.verifyOrderManifest(prepared.binding, operator, prepared.manifestSignature);
    const { lpAddress, recipient, confirmedRecipient } = await configuredAddresses();
    const preflight = await runOperatorPreflight({ lpAddress, recipient, confirmedRecipient, orders, controls });
    if (!preflight.readyForFirstPayment) throw new Error(`Strict preflight failed: ${preflight.blockers.join('; ')}`);
    const source = await checkSourceWalletA();
    if (!source.sufficientForPaymentAndFeeReserve) throw new Error('Wallet A lacks sufficient confirmed TAZ for payment and fee reserve');
    const activated = await orders.activateOperatorOrder(orderId, operator, { checkedAt: new Date().toISOString(), confirmedZatoshis: source.confirmedZatoshis, requiredZatoshis: source.requiredZatoshis });
    print({ stage: 'PAYMENT_INSTRUCTIONS_ACTIVE', orderId, source: { network: 'zcash-testnet', pool: 'ironwood', amountZatoshis: prepared.binding.sourceAmountZat, receiver: activated.receiver, minimumConfirmations: 10 }, destination: { network: 'base-sepolia', chainId: prepared.binding.destinationChainId, recipient: masked(prepared.binding.destinationRecipient), amountAtomic: prepared.binding.destinationAmountAtomic }, expiresAt: prepared.binding.expiresAt });
    break;
  }
  case 'authorize-payout': {
    const operatorId = options.operator ?? process.env.ZECATHON_OPERATOR_ID;
    const operator = required(operatorId, 'Operator ID'); const ownerId = required(options.owner, 'Owner ID'); const orderId = required(options.order, 'Order ID');
    requireInteractiveConfirmation(options.confirm, 'AUTHORIZE TESTNET PAYOUT APPROVAL');
    const id = await controls.authorize({ action: 'PAYOUT_APPROVAL', target: `${ownerId}:${orderId}`, operatorId: operator });
    print({ authorizationId: id, action: 'PAYOUT_APPROVAL', payoutPerformed: false }); break;
  }
  case 'apply-payout-approval': {
    const operatorId = options.operator ?? process.env.ZECATHON_OPERATOR_ID;
    const operator = required(operatorId, 'Operator ID');
    requireInteractiveConfirmation(options.confirm, 'APPLY AUTHORIZED PAYOUT APPROVAL');
    await executeAuthorizedPayoutApproval({ authorizationId: required(options.authorization, 'Authorization ID'), operatorId: operator, ownerId: required(options.owner, 'Owner ID'), orderId: required(options.order, 'Order ID'), controls, orders });
    print({ state: 'PAYOUT_AWAITING_OPERATOR_SUBMISSION', payoutPerformed: false }); break;
  }
  case 'help': print({
    commands: ['configure', 'bootstrap', 'configure-source-wallet', 'status', 'wallet-health', 'source-wallet', 'base-health', 'balances', 'orders', 'preview', 'readiness', 'preflight', 'prepare-order', 'authorize-address', 'recover-address', 'activate-order', 'authorize-payout', 'apply-payout-approval'],
    safety: 'No command signs, sends, broadcasts, unlocks a wallet, creates a funded order, or performs a payout. Mutating address derivation requires a signed, scoped, expiring authorization and a second interactive confirmation.',
  }); break;
  default: throw new Error(`Unknown operator command: ${command}`);
}
