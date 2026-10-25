# AI agent operator runbook

The AI gateway is disabled by default. Credentials alone do not enable external calls. Do not add an API key to the repository, an environment file in the repository, shell history, logs, tickets, or chat.

## Dedicated project and budget

Create a dedicated API project for this isolated validation. Restrict model access to the single reviewed model, configure project request/token rate limits, set a small monthly spend limit, enable hard-limit enforcement, and add early spend alerts. OpenAI notes that hard-limit enforcement is not instantaneous, so recorded spend can slightly exceed the configured limit.

Create a project-scoped restricted key or project service account for this application. Grant only the permission needed to call `/v1/responses`; do not use an organization admin key or a key shared with another application. OpenAI displays a newly created service-account secret once, so transfer it directly into the protected file and close the display.

Primary references:

- https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform
- https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety
- https://developers.openai.com/api/docs/guides/your-data

For Groq validation, create a dedicated Groq project/key with the narrowest available limits. Free-tier availability and limits are account- and plan-dependent; the application does not assume calls are free. The reviewed initial model ID is exactly `openai/gpt-oss-20b`.

Groq references:

- https://console.groq.com/docs/responses-api
- https://console.groq.com/docs/model/openai/gpt-oss-20b
- https://console.groq.com/docs/rate-limits
- https://console.groq.com/docs/your-data
- https://console.groq.com/docs/production-readiness/security-onboarding

## Store the credential outside the repository

Choose an absolute path owned by the runtime operator and outside this repository. Create the file with mode `0600` using a local secret editor or secret manager, paste the key directly there, and verify the file is a regular non-symlink owned by the runtime user. Never print or `cat` the credential during verification.

Configure only paths and non-secret controls in the process environment:

```text
AI_PROVIDER=openai-responses
AI_MODEL=<exact reviewed Responses-compatible model ID>
AI_API_KEY_FILE=<absolute path outside the repository>
AI_BASE_URL=https://api.openai.com/v1
AI_MAX_OUTPUT_TOKENS=600
AI_MAX_PROVIDER_CALLS=3
AI_AGENT_REQUESTS_PER_MINUTE=10
```

At this point the application remains in limited mode and makes no external model calls.

For the reviewed Groq adapter, use this mutually exclusive provider configuration instead:

```text
AI_PROVIDER=groq-responses
AI_MODEL=openai/gpt-oss-20b
AI_API_KEY_FILE=<absolute path outside the repository>
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MAX_OUTPUT_TOKENS=600
AI_MAX_PROVIDER_CALLS=3
AI_AGENT_REQUESTS_PER_MINUTE=10
```

The key file rules are identical: a regular non-symlink file, mode `0600`, owned by the runtime user in production. Create and populate it locally through a secret manager or private editor. Never pass the key on the command line, print it, add it to an environment file in this repository, or share it in chat.

## Retention disclosure

The adapter sends foreground Responses requests with `store:false` and replays tool-call state locally. This disables requested Responses application-state storage, but it is not a promise of zero retention. OpenAI documents that default abuse-monitoring logs may retain prompts, responses, and derived metadata for up to 30 days unless the organization has been approved for Modified Abuse Monitoring or Zero Data Retention. Confirm the project’s actual data-control status before real-user use.

Groq’s Responses API does not support the `store` parameter, including `store:false`, so the Groq adapter omits it. This is not equivalent to an application-level no-storage instruction. Groq states that inference inputs and outputs are not retained by default, but they may be temporarily logged for reliability and abuse prevention for up to 30 days unless the organization has Zero Data Retention enabled; usage metadata is retained and Groq documents US processing/storage. Confirm the project’s Data Controls status before any real-user use and do not describe the default as zero retention.

Groq’s current Responses compatibility also excludes `previous_response_id`, `truncation`, `include`, `safety_identifier`, `prompt_cache_key`, and reusable `prompt`. The adapter sends none of these. It replays bounded response items and tool outputs locally. Groq may return `400` for invalid generated tool calls and `429` for rate limits; provider response bodies are not reflected to users, while a bounded retry delay and request ID can be retained internally for diagnosis.

The gateway sends only the user’s bounded text, registered tool schemas, and bounded redacted tool results. It rejects wallet addresses, transaction identifiers, viewing/spending keys, cookies, and secret-shaped input before provider access. It never sends payment receivers, raw database rows, encrypted evidence, private receipts, UFVKs, or operator records.

## Separate chargeable-request opt-in

After reviewing the project, model, budget, retention disclosure, and credential path, an operator must deliberately add this exact process-level value:

```text
AI_EXTERNAL_REQUESTS_APPROVED=I_APPROVE_CHARGEABLE_MODEL_REQUESTS
```

Any missing or different value leaves the assistant in limited mode without reading the key file. Remove this value to disable external requests again.

The runtime additionally enforces a 20-second provider timeout, at most three provider calls per user request, at most 600 output tokens per provider call by default, a 32 KB serialized provider-input boundary, a 16 KB tool-output boundary, a 256 KB provider-response boundary, and ten assistant HTTP requests per client per minute. Tune only within the validated code ranges. These application limits bound request size and call count; the dedicated project hard spend limit is still required because monetary cost depends on the selected model’s current pricing.

## One-shot isolated live validation

Do not point this command at durable staging. The validator creates one synthetic, unfunded in-memory request and cannot allocate an address or move funds. A second explicit approval is required in addition to the runtime opt-in:

```text
AI_LIVE_VALIDATION_APPROVED=I_APPROVE_LIVE_AI_VALIDATION corepack pnpm agent:validate-live
```

The command checks privacy explanation, the registered route, the fixed swap preview, custody/refunds, owner-scoped status, and local refusal boundaries. It prints response text, tool names, provider-call counts, and token usage, but never prints the API key. Success prints `LIVE_AI_AGENT_VERIFIED`. A failure must be investigated without weakening tool authorization or privacy filters.

## One-interaction Groq live validation

Do not run this until a human operator has reviewed the Groq project limits, data controls, exact model, and secure key path. It uses one public route question and an in-memory store; it reads no account or order data and cannot create an order. Because function calling requires a model-to-tool-to-model round trip, this single validation interaction can make up to two billable Responses API requests.

Set the normal external-request approval and the additional one-shot approval only in the isolated validation process, then run:

```text
AI_PROVIDER=groq-responses \
AI_MODEL=openai/gpt-oss-20b \
AI_API_KEY_FILE=<absolute-private-key-path> \
AI_BASE_URL=https://api.groq.com/openai/v1 \
AI_EXTERNAL_REQUESTS_APPROVED=I_APPROVE_CHARGEABLE_MODEL_REQUESTS \
GROQ_LIVE_VALIDATION_APPROVED=I_APPROVE_ONE_GROQ_LIVE_VALIDATION \
corepack pnpm agent:validate-groq-live
```

Success prints `GROQ_LIVE_VALIDATION_VERIFIED`, the tool used, provider-call count, token usage, and the public response. It never prints the key. Remove both approval values after the test.
