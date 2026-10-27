# Verified two-minute Zecathon walkthrough

Use the local production build or an independently approved HTTPS demo. Do not show fabricated orders, provider responses, transfers, or receipts.

## 0:00–0:20 — The privacy boundary

Show the landing hero and exact route.

> “Zecori is a privacy-first route desk for one constrained testnet flow: exactly 0.01 shielded TAZ to exactly 1 test USDC on Base Sepolia. It makes the transparent destination and trusted-provider custody explicit.”

## 0:20–0:45 — Explore before signing in

Open Routes, inspect the implemented route, and point to the operator-readiness state, fixed-test-rate, custody, confirmation, and no-funds warnings.

> “Guests can inspect the implemented flow. Request creation stays closed unless this deployment has a current operator readiness attestation, and Zecori never invents a provider quote.”

## 0:45–1:10 — Account and recipient safety

Use an isolated fixture account or the already-recorded screenshot. Show passkey sign-in, the manual Base Sepolia recipient, and the destination-control explanation.

> “The signature proves control of this exact destination only. It cannot transfer tokens, change the recipient, authorize payout, or give the app wallet authority.”

## 1:10–1:30 — Handles and inbox

Show the confirmed optional handle and private inbox screenshots.

> “Handles use exact opt-in discovery and never reveal an address. A handle can create a non-paying request intent, while real account and order events reach a durable owner-only inbox through a transactional outbox.”

## 1:30–1:48 — Assistant and evidence

Ask the deterministic assistant what the supported route is, then open Activity or the evidence documentation.

> “Typed cards are grounded in server facts. The assistant cannot sign, pay, allocate an address, approve settlement, or manufacture success. Private receipts appear only from backend-owned lifecycle evidence. Accepted payment instructions require no memo and show exact assets, networks, amounts, fee status, expiry, refund policy, and the operator-correlation boundary before any manual send.”

## 1:48–2:00 — Honest limits

Open the roadmap/evidence page.

> “Mainnet, payment by handle, automatic settlement and refunds, Privy, live provider calls, external alerts, the public judge deployment, and the first funded linked swap remain off or unverified. Public receipts also remove exact amounts and timestamps to reduce correlation. The release fails closed where evidence is missing.”

End on “Private origin. Verified arrival.”
