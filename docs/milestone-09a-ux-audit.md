# Milestone 09A UX audit

Audit date: 2026-10-26
Branch: `feat/milestone-08a-consumer-privy`

## What already works

- The landing page states the only executable route and its fixed test terms before sign-in.
- The route flow preserves Ironwood-only source rules, Base Sepolia recipient validation, explicit consent, purpose-limited destination proof, and backend-controlled settlement state.
- Passkeys, owner-scoped history, private receipts, assistant tool boundaries, wrong-network rejection, reduced motion, and Arabic RTL rendering have browser coverage.
- Disabled routes and planned capabilities are represented as unavailable instead of fabricated.

## Usability issues observed before redesign

1. The public hero explains the product, but it does not show the working product journey or offer a direct judge walkthrough.
2. The landing page omits the planned roadmap requested for handles, contacts, event-backed notifications, provider comparisons, voice, and language expansion.
3. The lime/moss visual system reads as general privacy software rather than Zcash-first. It does not match the requested dark ink, warm ivory, and Zcash-gold direction.
4. Product navigation on a 390 px viewport becomes a horizontally scrolling strip. There is no compact menu or clear mobile navigation state.
5. The eight-stage journey rail is also horizontal on mobile and does not summarize the current stage in plain language.
6. Route copy begins with protocol-heavy framing before the simpler action and limitation.
7. API bootstrap errors appear on `/swap` but are not visible on Account, Activity, or Assistant.
8. The assistant disables its input while working but does not show an explicit thinking state. Request failures look like ordinary assistant answers rather than errors.
9. Activity rows are buttons that navigate to the homepage, which is an unexpected and misleading destination.
10. Guest Activity uses the heading “Authenticated activity” before authentication and offers no direct return to route exploration inside the gate.
11. The empty activity state explains what is absent but does not provide a next action.
12. Static Vite preview has no API, so direct app-state captures can remain blank while bootstrap waits. Safe review should use the disposable backend browser harness or the local production server configuration.

## Constraints retained

- No invented quotes, provider availability, settlement success, or executable planned features.
- No automatic wallet creation, transaction signing, broadcast, address allocation, payout, or refund behavior.
- No changes to migrations, ownership isolation, destination binding, settlement verification, or receipt privacy.
