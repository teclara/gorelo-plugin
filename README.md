# Gorelo plugin for Claude Code

Work with your [Gorelo](https://www.gorelo.io) PSA/RMM tenant from Claude Code: tickets, clients, contacts, assets, projects, time, uptime checks and billing.

> Community project, not affiliated with or endorsed by Gorelo.

## Install

```
/plugin marketplace add teclara/gorelo-plugin
/plugin install gorelo-plugin@teclara
```

Requires Node 20+. When you enable the plugin, Claude Code asks for:

| Setting | Values |
|---|---|
| Gorelo API key | Stored in your OS keychain, never in settings files |
| Region | `usw` (US) or `aue` (Australia) |
| Access tier | `read` (default), `write`, `full` |

## Access tiers

| Tier | What Claude can do |
|---|---|
| `read` | Look up anything. Cannot change anything. |
| `write` | Also: create/update tickets, projects, tasks, comments, clients, contacts, time entries, uptime checks (incl. maintenance), upload attachments, post alerts, create **draft** invoices |
| `full` | Also: the `gorelo_admin` tool: deletes, approving/voiding invoices, catalogue item changes |

**Scope your API key to match the tier.** The key is the real limit: a read-only key cannot write even if the plugin is set to `full`.

`gorelo_admin` is a separate tool so you can auto-allow everyday tools while every destructive call still asks you first. **If you run Claude Code with bypass permissions, that prompt is skipped.**

Keep these on "ask" rather than auto-allowed, even in the `write` tier:

- `gorelo_attachments`: it reads a file from your disk and sends it to Gorelo.
- Anything that emails people: public ticket or task comments (`create_comments`) and side conversations or approvals (`create_conversations_*`) on `gorelo_tickets` and `gorelo_project_tasks`.

Ticket text is written by end users and is untrusted. A prompt injection in a ticket could ask Claude to attach a local file or email someone, and the permission prompt is your chance to catch it. The server also refuses to upload hidden (dot) files, anything inside a dot-directory such as `~/.ssh`, non-regular files, and files over 25 MB.

Every non-read call is logged locally to `~/.claude/plugins/data/<plugin-id>/audit.jsonl`.

## Skills

| Skill | Use it for |
|---|---|
| `gorelo-status` | Is it connected? What can the key reach? |
| `gorelo-triage` | Morning check: tickets, offline agents, down uptime checks |
| `gorelo-client-overview` | One-page client briefing before a call |
| `gorelo-log-time` | "Log 1.5h on the Acme printer ticket" |
| `gorelo-uptime-maintenance` | Maintenance windows for uptime checks |
| `gorelo-invoice-draft` | Draft (never approve) a manual invoice |

## Development

```
npm install
npm run codegen   # regenerate server/generated from Gorelo's live spec
npm test
npm run build     # rebuild server/dist/index.js (committed)
```

Tools are generated from Gorelo's public OpenAPI spec. A weekly workflow opens a PR when Gorelo adds or changes endpoints. Naming and tier overrides live in `server/tool-map.ts`.

The weekly spec-drift workflow runs the tests, typecheck, lint and plugin validation itself, because PRs opened with `GITHUB_TOKEN` don't trigger `ci.yml`. If any check fails, it opens the PR as a draft and puts the failure output in the PR body. For the workflow to open PRs at all, enable **Settings > Actions > General > "Allow GitHub Actions to create and approve pull requests"** on the repository. If the repo belongs to an organization, the org must allow it too.

## License

MIT
