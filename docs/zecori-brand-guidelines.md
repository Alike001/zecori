# Zecori brand guidelines

Status: provisional customer-facing identity for Milestone 08D. This is not trademark, company-name, handle, or domain clearance.

## Core expression

- Name: **Zecori**
- Tagline: **Your Zcash. More possibilities.**
- Product sentence: Zecori coordinates one experimental route from a shielded Zcash testnet source to a transparent Base Sepolia destination, with explicit custody and evidence boundaries.
- Voice: calm, exact, privacy-literate, and evidence-led. Never imply a trustless bridge, live price, automatic settlement, guaranteed refund, or completed transaction without verified backend evidence.

## Mark

The private-origin route mark is stored at `public/brand/zecori-mark.svg` and used inline by `src/Brand.tsx`. A concealed circular origin meets a privacy boundary, then divides into two visible evidence points. The construction is deliberately not a letter Z, shield, lock, or chain link.

Use the mark with the Zecori wordmark at 120 px minimum total width, or alone at 24 px minimum. Keep clear space equal to half the mark width. Do not rotate, stretch, outline, shadow, recolor outside the tokens below, or imply that the mark denotes a trustless protocol.

## Palette

| Token | Dark | Light | Use |
|---|---:|---:|---|
| Page | `#07100d` | `#f4f7f2` | Primary canvas |
| Surface | `#0d1915` | `#ffffff` | Cards and grouped UI |
| Ink | `#edf5f0` | `#14231d` | Primary text and route line |
| Muted | `#91a39b` | `#52665d` | Supporting copy |
| Sprout | `#d9f759` | `#496b00` | Primary action and private-origin state |
| Evidence teal | `#63d7c1` | `#087a68` | Public evidence points |
| Warning | `#e9ce82` | `#705500` | Custody and pending states |
| Danger | `#ffb7a9` | `#8d2e21` | Blocking errors |

Normal text must retain at least WCAG AA 4.5:1 contrast, large text and UI boundaries at least 3:1. State never depends on color alone: badges, icons, and plain-language labels accompany it.

## Type, layout, and motion

The application uses a system sans stack for fast, private loading and a system serif accent only in display emphasis. Body text remains at least 16 px where it carries instructions; compact metadata is supplemental. Headings use short lines and body content stays near 65 characters per line.

Transitions communicate navigation, focus, and state. They never simulate a financial transaction or advance a lifecycle without backend evidence. `prefers-reduced-motion: reduce` removes reveal animation and collapses transition duration.

## Product usage

- Navigation uses the mark, Zecori wordmark, and context label.
- The favicon uses the mark alone.
- Private receipts use the wordmark plus “Verified receipt”; verification still comes from receipt data, not branding.
- Documentation uses the same truth-status vocabulary as the product.
- Internal compatibility names such as the repository directory, npm package, database, cookies, protocol identifiers, and `ZECATHON_*` environment variables stay unchanged.

## Clearance gate

Before public commercial launch, complete exact and phonetic searches across relevant trademark registries, corporate registries, app stores, package registries, domains, and social handles. Document target jurisdictions, Nice classes, confusion risks, and counsel review. Provisional use in this hackathon repository is not evidence of availability.
