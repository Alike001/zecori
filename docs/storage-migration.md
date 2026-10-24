# Local JSON to PostgreSQL migration status

The PostgreSQL schema preserves immutable manifests, allocation journals, authorization records, replay-safe settlement evidence, receipts, state versions, expiry, unresolved states, and append-only audit events.

The production operator CLI now writes only PostgreSQL. Existing `orders.json` and `operator-control.json` files remain untouched legacy inputs: they are not read, mutated, or silently imported by production commands. No records, HMAC keys, cookies, wallet files, or receiver data have been migrated.

Before implementing or running an importer:

1. Stop operator mutations and make a mode-0600 backup of the JSON database outside the repository.
2. Verify the JSON schema and count orders, allocations, prepared orders, receipt references, and receipts.
3. Provision an application encryption key separately from the operator HMAC key.
4. Import into a new PostgreSQL database in one transaction, encrypting receiver and private evidence fields before insertion.
5. Compare every source record and uniqueness constraint before committing.
6. Start the application in read-only comparison mode and compare both stores.
7. Use a separately reviewed one-shot importer; the production CLI has no automatic import path.

There is intentionally no automatic importer in this milestone: silent or accidental migration of private operator records is forbidden.

## Encryption keyring and rotation

`ZECATHON_ENCRYPTION_KEY_FILE` points to a mode-`0600` JSON file in a mode-`0700` directory outside the repository. Its schema is:

```json
{"activeVersion":2,"keys":{"1":"BASE64_32_BYTE_OLD_KEY","2":"BASE64_32_BYTE_ACTIVE_KEY"}}
```

Private order state, payment receivers, chain evidence, and private receipts use AES-256-GCM with a fresh 96-bit nonce, a 128-bit authentication tag, explicit envelope/key versions, and field-specific authenticated context. The operator HMAC key and wallet keys are never accepted as encryption keys.

For rotation, add a new 32-byte key under a new integer version, retain all old keys needed to decrypt durable rows and backups, change `activeVersion`, restart, and run the test suite. New writes use the active version; old rows remain readable. This milestone does not bulk re-encrypt old rows. Back up the keyring separately from database dumps, encrypt both backups at rest, restrict recovery access, and test a joint restore. Losing an old key permanently loses the corresponding private fields.
