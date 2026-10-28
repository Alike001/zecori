import test from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { createPrivatePayoutServer } from './private-payout-server.ts';
import type { PrivatePayoutService } from './private-payout-service.ts';
import { createServer } from 'node:net';

export async function availablePort():Promise<number> {
  const server=createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return port;
}

test('private operator HTTP enforces authentication, Host, Origin, CSP, CSRF and request replay',async t=>{
  const port=await availablePort(),origin=`http://127.0.0.1:${port}`,token='a'.repeat(64);let calls=0;
  const service={async preview(){return {private:true};},async begin(){calls++;return {started:true};}} as unknown as PrivatePayoutService;
  const server=createPrivatePayoutServer({service,port,loginToken:token});await new Promise<void>(resolve=>server.listen(port,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const page=await fetch(origin);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy')!,/frame-ancestors 'none'/);assert.equal(page.headers.get('cache-control'),'no-store');
  assert.equal((await fetch(`${origin}/api/preview?packet=x`)).status,401);
  assert.equal(await new Promise<number>((resolve,reject)=>{const request=httpRequest(origin,{headers:{Host:'evil.example'}},response=>{response.resume();resolve(response.statusCode!);});request.on('error',reject);request.end();}),403);
  assert.equal((await fetch(origin,{headers:{Origin:'https://evil.example'}})).status,403);
  const login=await fetch(`${origin}/api/login`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token})});
  const {csrf}=await login.json();const cookie=login.headers.get('set-cookie')!.split(';')[0];assert.match(login.headers.get('set-cookie')!,/HttpOnly; SameSite=Strict/);
  const challenge=await fetch(`${origin}/api/challenge`,{headers:{Cookie:cookie}}).then(r=>r.json());
  const headers={Cookie:cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf,'X-Operator-Nonce':challenge.nonce};
  const request={method:'POST',headers,body:JSON.stringify({packetId:'00000000-0000-4000-8000-000000000111',observations:{},confirmation:'reviewed'})};
  assert.equal((await fetch(`${origin}/api/begin`,{...request,headers:{...headers,Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(`${origin}/api/begin`,{...request,headers:{...headers,'X-CSRF-Token':'wrong'}})).status,403);
  assert.equal((await fetch(`${origin}/api/begin`,request)).status,200);
  assert.equal((await fetch(`${origin}/api/begin`,request)).status,409);assert.equal(calls,1);
});
