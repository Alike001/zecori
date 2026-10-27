# AI and voice boundary

Status: deterministic AI `VERIFIED`; Groq chat and speech `EXPERIMENTAL`; live provider validation not approved or run.

## What works without an external provider

The server can answer registered-route and privacy questions, prepare a non-binding review card, and—after account authentication—return an owner-scoped order status or recovery card. Cards are constructed from application data after the tool executes; model prose is never trusted as card data.

Safe examples:

- “Which route is available?” returns the exact `0.01 TAZ → 1 test USDC` fixed test terms and says they are not a market quote.
- “Prepare the route review” returns a checklist with `createsOrder: false`, `authorizesPayment: false`, and `signsTransaction: false`.
- “What is the status of request <UUID>?” returns a redacted backend status only when the signed-in account owns that request.
- “How do I recover request <UUID>?” returns status-specific guidance and never recommends resending funds.

Unsupported routes, incorrect amounts, invented providers or prices, unverified completion claims, transaction hashes, prompt injection, private wallet material, and cross-account reads fail closed. No registered AI tool can allocate an address, derive a Zcash address, create a funded order, sign, broadcast, authorize payment, approve payout, or operate a wallet.

## Groq integration

Credentials stay in a mode-`0600` server file. Chat requires the exact `AI_EXTERNAL_REQUESTS_APPROVED` value. Speech has a separate `VOICE_EXTERNAL_REQUESTS_APPROVED` gate. The browser receives neither key nor provider credential. Provider calls have a 20-second timeout, one bounded retry for network/429/5xx failures, response-size limits, and malformed-response checks.

The opt-in live validator lists the current account model inventory, requires these exact IDs, performs one grounded chat round trip, and records returned quota headers:

- `openai/gpt-oss-20b`
- `whisper-large-v3-turbo`
- `canopylabs/orpheus-v1-english`
- `canopylabs/orpheus-arabic-saudi`

Run only after explicit approval. It was not run for 08C:

```sh
GROQ_LIVE_VALIDATION_APPROVED=I_APPROVE_ONE_GROQ_LIVE_VALIDATION \
AI_EXTERNAL_REQUESTS_APPROVED=I_APPROVE_CHARGEABLE_MODEL_REQUESTS \
pnpm agent:validate-groq-live
```

Groq says exact limits vary by organization and must be checked on the account Limits page. Its public Developer-plan base table, checked 2026-10-26, lists:

| Model | RPM | RPD | TPM | TPD | ASH | ASD |
|---|---:|---:|---:|---:|---:|---:|
| `openai/gpt-oss-20b` | 30 | 1,000 | 8,000 | 200,000 | — | — |
| `whisper-large-v3-turbo` | 20 | 2,000 | — | — | 7,200 | 28,800 |
| each configured Orpheus model | 10 | 100 | 1,200 | 3,600 | — | — |

These are published base limits, not verified Zecathon-account quotas. Sources: [Groq rate limits](https://console.groq.com/docs/rate-limits), [Groq speech-to-text](https://console.groq.com/docs/speech-to-text), and [Groq Orpheus TTS](https://console.groq.com/docs/text-to-speech/orpheus).

## Recording, consent, and retention

Voice requires an authenticated session, same-origin request, CSRF token, explicit disclosure checkbox, and browser microphone permission. The UI exposes requesting, recording, processing, transcript-review, playback, and error states. A recording is limited to 30 seconds and 2 MB. Recordings shorter than 500 ms are rejected.

Audio is accumulated in browser memory, sent as raw audio to the authenticated server endpoint, wrapped in multipart form data, and forwarded to Groq. The application does not write it to disk or database. The server zeroes its input buffer after the provider returns. This does not override Groq's own processing or abuse/reliability logging; reviewers must evaluate Groq's current data terms before enabling voice.

The transcript is always editable. “Use reviewed text” only copies it into the chat input; it does not submit automatically. Incorrect TAZ/USDC amounts, private addresses, transaction identifiers, silence, microphone refusal, oversized/long clips, network failures, rate limits, timeouts, and malformed provider responses are blocked or fall back to text.

## Language matrix

| Language | UI | AI text | Speech recognition | Voice output | Acceptance status |
|---|---|---|---|---|---|
| English | Partial | Supported | Configured | `canopylabs/orpheus-v1-english` | Automated contracts only; microphone and pronunciation untested |
| French | Partial | Supported | Configured | Text-only fallback | Security copy needs human review |
| Arabic | Partial RTL | Supported | Configured | `canopylabs/orpheus-arabic-saudi` | Security copy, microphone, Saudi-dialect fit, and pronunciation need human review |

Groq documents Whisper as multilingual and accepts ISO-639-1 language hints. Its Orpheus page documents English and Saudi Arabic models and a 200-character TTS limit. The product does not claim generic Arabic-dialect coverage. Addresses, `TAZ`, `USDC`, chain IDs, and transaction hashes are never translated.

## Explicitly untested in 08C

- Current Zecathon Groq account model permissions and exact quota values.
- Any real Groq chat, transcription, or speech request.
- Physical microphone permission prompts on Chrome, Safari, Firefox, Android, or iOS.
- English, French, or Arabic speech-recognition accuracy, including amounts and accents.
- English or Saudi Arabic TTS pronunciation, especially `TAZ`, `USDC`, and safety warnings.
- Provider retention behavior beyond the documented application-side memory cleanup.
