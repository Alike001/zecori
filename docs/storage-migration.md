# Local JSON to PostgreSQL migration status

The PostgreSQL schema preserves immutable manifests, allocation journals, authorization records, replay-safe settlement evidence, receipts, state versions, expiry, unresolved states, and append-only audit events.

The current operator CLI still writes the existing private JSON store. No records, HMAC keys, cookies, wallet files, or receiver data have been migrated.

Before implementing or running an importer:

1. Stop operator mutations and make a mode-0600 backup of the JSON database outside the repository.
2. Verify the JSON schema and count orders, allocations, prepared orders, receipt references, and receipts.
3. Provision an application encryption key separately from the operator HMAC key.
4. Import into a new PostgreSQL database in one transaction, encrypting receiver and private evidence fields before insertion.
5. Compare every source record and uniqueness constraint before committing.
6. Start the application in read-only comparison mode and compare both stores.
7. Switch the operator CLI only after explicit operator approval and a tested rollback.

There is intentionally no automatic importer in this milestone: silent or accidental migration of private operator records is forbidden.
