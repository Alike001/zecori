import type { ShareableReceipt } from './receipt.ts';
import type { OrderView } from '../../server/order-api.ts';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? 'Coordinator request failed');
  return value;
}

export async function listOrders(): Promise<OrderView[]> {
  return (await request<{ orders: OrderView[] }>('/api/orders')).orders;
}

export async function getFinalReceipt(receiptId: string): Promise<ShareableReceipt> {
  return request<ShareableReceipt>(`/api/receipts/${encodeURIComponent(receiptId)}`);
}
