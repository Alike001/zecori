import test from 'node:test';
import assert from 'node:assert/strict';
import { exactJsonInteger, jsonRpcClient, parseJsonPreservingIntegers } from './rpc-client.ts';

test('preserves arbitrary-precision response integers as exact decimal strings', () => {
  const parsed = parseJsonPreservingIntegers('{"result":{"diversifier_index":309485009821345068724781055}}') as { result: { diversifier_index: string } };
  assert.equal(parsed.result.diversifier_index, '309485009821345068724781055');
});

test('serializes an explicit arbitrary-precision RPC integer without quotes', async () => {
  let body = '';
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => { body = String(init?.body); return new Response('{"result":{"address":"utest1x","diversifier_index":309485009821345068724781055},"error":null}'); };
  try {
    const rpc = jsonRpcClient('http://127.0.0.1:1');
    const result = await rpc<{ diversifier_index: string }>('z_getaddressforaccount', [0, ['orchard'], exactJsonInteger('309485009821345068724781055')]);
    assert.match(body, /,309485009821345068724781055\]/);
    assert.doesNotMatch(body, /"309485009821345068724781055"/);
    assert.equal(result.diversifier_index, '309485009821345068724781055');
  } finally { globalThis.fetch = original; }
});

test('rejects unsafe ordinary Number parameters', async () => {
  const rpc = jsonRpcClient('http://127.0.0.1:1');
  await assert.rejects(rpc('example', [Number.MAX_SAFE_INTEGER + 1]), /safe integers/);
});
