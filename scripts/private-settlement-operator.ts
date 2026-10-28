#!/usr/bin/env node
import { readFile,lstat } from 'node:fs/promises';
import { assertOutsideWorkspace } from '../server/private-storage.ts';
import { createPostgresPool } from '../server/postgres.ts';
import { loadEncryptionKeyring } from '../server/data-encryption.ts';
import { loadOperatorConfig } from '../server/operator-config.ts';
import { OperatorControlStore } from '../server/operator-control.ts';
import { PostgresSettlementStore } from '../server/postgres-settlement-store.ts';
import { baseSepoliaRpc } from '../server/base-sepolia-verifier.ts';
import { PrivatePayoutService } from '../server/private-payout-service.ts';
import { createPrivatePayoutServer } from '../server/private-payout-server.ts';

// Never started by app-server, Render, migration, or public feature flags.
const operatorId=process.env.ZECATHON_OPERATOR_ID?.trim();
const tokenFile=process.env.ZECORI_OPERATOR_LOGIN_TOKEN_FILE;
const databaseUrl=process.env.ZECORI_OPERATOR_DATABASE_URL;
if(!operatorId||!tokenFile||!databaseUrl)throw new Error('Named operator, private login token file, and explicit dedicated coordinator URL are required');
if(process.env.RENDER)throw new Error('Private operator server must run on the operator host');
assertOutsideWorkspace(tokenFile);
const metadata=await lstat(tokenFile);
if(!metadata.isFile()||(metadata.mode&0o777)!==0o600||metadata.uid!==process.getuid?.())throw new Error('Login token file must be an operator-owned regular mode-0600 file');
const loginToken=(await readFile(tokenFile,'utf8')).trim();
const port=Number(process.env.ZECORI_OPERATOR_PORT??'8789');
if(!Number.isSafeInteger(port)||port<1024||port>65535)throw new Error('Invalid private operator port');
const pool=createPostgresPool(databaseUrl);
try {
  const config=await loadOperatorConfig(),encryption=await loadEncryptionKeyring(),controls=new OperatorControlStore();
  const settlements=new PostgresSettlementStore(pool,encryption);await settlements.health();
  // Optional approval is scoped to exactly one existing packet; absent means no spending.
  const approvedPacketId=process.env.ZECORI_OPERATOR_APPROVED_PACKET;
  if(approvedPacketId&&!/^[0-9a-f-]{36}$/i.test(approvedPacketId))throw new Error('Invalid approved packet ID');
  const service=new PrivatePayoutService({pool,settlements,controls,operatorId,lpSender:config.lpSender,rpc:baseSepoliaRpc(),approvedPacketId});
  const server=createPrivatePayoutServer({service,loginToken,port});
  server.listen(port,'127.0.0.1',()=>process.stdout.write(`Private settlement operator: http://127.0.0.1:${port} (broadcast ${approvedPacketId?'scoped approval loaded':'disabled'})\n`));
  const close=()=>server.close(()=>{void pool.end();});process.once('SIGINT',close);process.once('SIGTERM',close);
}catch(error){await pool.end();throw error;}
