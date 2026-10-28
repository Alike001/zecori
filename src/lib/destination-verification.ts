import { recoverTypedDataAddress, type Address, type Hex } from 'viem';
import { normalizeEvmAddress } from './evm-address.ts';

export async function assertLocalDestinationSigner(
  typedData: Record<string, unknown>,
  signature: string,
  expectedRecipient: string,
): Promise<void> {
  let recovered: Address;
  try {
    recovered = await recoverTypedDataAddress({
      ...(typedData as Omit<Parameters<typeof recoverTypedDataAddress>[0], 'signature'>),
      signature: signature as Hex,
    });
  } catch {
    throw new Error('The wallet returned a signature that could not be checked locally. The proof was not submitted.');
  }
  let normalizedRecovered: string; let normalizedExpected: string;
  try {
    normalizedRecovered = normalizeEvmAddress(recovered);
    normalizedExpected = normalizeEvmAddress(expectedRecipient);
  } catch {
    throw new Error('The signing wallet or reviewed receiving address is invalid. The proof was not submitted.');
  }
  if (normalizedRecovered !== normalizedExpected) {
    throw new Error('The signing wallet does not match the reviewed receiving address. The proof was not submitted.');
  }
}
