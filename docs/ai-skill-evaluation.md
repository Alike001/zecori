# Design and browser-testing skill evaluation

Evaluation date: 2026-10-27
Source catalog: [skill-issue.in](https://skill-issue.in/)
Decision: **no skill installed and no installer executed**

The catalog is discovery metadata, not a trust root. Each candidate was traced to its original GitHub source and inspected read-only. Popularity counters were treated as unverified marketing/telemetry, not security evidence.

| Candidate | Original source | Trust boundary | Decision |
| --- | --- | --- | --- |
| `ui-ux-pro-max-skill` | [`nextlevelbuilder/ui-ux-pro-max-skill`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), MIT | Large repository with Python and Node search/generation scripts, asset fetching, templates, and optional global installers. Guidance extends beyond a static checklist. | Do not install for 09B. Existing design review was sufficient and the task forbids an unnecessary redesign. |
| `agent-browser` | [`vercel-labs/agent-browser`](https://github.com/vercel-labs/agent-browser), Apache-2.0 | Browser-control CLI with a package `postinstall`, platform-native binaries, browser/profile access, and network-capable automation. High privilege even though the source organization is reputable. | Do not install. Zecori already has reviewed, narrow CDP smoke harnesses with disposable profiles. |
| `web-design-guidelines` | [`vercel-labs/agent-skills`](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) | The skill is mostly instructions but tells the agent to fetch a mutable remote guideline document on every use. Repository license metadata is not declared at the root. | Suitable for human-reviewed snapshot audits, but not installed or allowed to fetch instructions automatically. |
| `accessibility-compliance` | [`wshobson/agents`](https://github.com/wshobson/agents/tree/main/plugins/ui-design/skills/accessibility-compliance), MIT | The selected skill is guidance-oriented, but installation targets a broad multi-plugin repository. Automated claims still require axe/manual assistive-technology evidence. | Potentially useful later; not needed for the existing semantic/reduced-motion/browser checks. Do not install now. |

## Recommendation

For this repository, retain the checked-in CDP/WebAuthn test scripts and the current focused design audit. If a future reviewer wants an external skill, pin an exact reviewed Git commit, copy only the selected instruction/resources after inspection, record hashes and license, prohibit install hooks, and run any executable helper in a disposable environment without secrets, wallet profiles, or durable browser data.
