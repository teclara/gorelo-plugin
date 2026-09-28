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

**No Gorelo tools until the API key is set.** Claude Code won't start the plugin's MCP server while the API key is empty, so the skills show up but none of the `gorelo_*` tools do. If you skipped the prompt, run `/plugin`, open gorelo-plugin, choose configure, enter the key, and then check `/mcp` shows `gorelo` as connected.

## Access tiers

| Tier | What Claude can do |
|---|---|
| `read` | Look up anything. Cannot change anything. |
| `write` | Also: create/update tickets, projects, tasks, comments, clients, contacts, time entries, uptime checks (incl. maintenance), upload attachments, post alerts, create **draft** invoices |
| `full` | Also: the `gorelo_admin` tool: deletes, approving/voiding invoices, catalogue item changes |

**Scope your API key to match the tier.** The key is the real limit: a read-only key cannot write even if the plugin is set to `full`.

### Tools and permissions

Claude Code grants permissions per tool, so the tools are split by what they can do:

| Tools | Contain | Suggested permission |
|---|---|---|
| `gorelo_tickets`, `gorelo_clients`, `gorelo_time_entries`, ... (no suffix) | Lookups only (`GET`). Marked read-only in every tier. | Safe to auto-allow |
| `gorelo_tickets_write`, `gorelo_time_entries_write`, `gorelo_invoices_write`, ... (`write` tier and up) | Every create, update and upload for that resource | Keep on "ask" |
| `gorelo_admin` (`full` tier) | Deletes, approving/voiding invoices, catalogue item changes | Keep on "ask" |

The rule has no exceptions: a tool without the `_write` suffix never changes anything, and a resource that has only writes (attachments, alerts) exists only as `gorelo_attachments_write` and `gorelo_alerts_write`. Auto-allowing `gorelo_tickets` for lookups therefore does not allow `gorelo_tickets_write`. **If you run Claude Code with bypass permissions, every prompt is skipped.**

Keep the `*_write` tools on "ask" rather than auto-allowed. These matter most:

- `gorelo_attachments_write`: it reads a file from your disk and sends it to Gorelo.
- `gorelo_tickets_write` and `gorelo_project_tasks_write`: public comments (`create_comments`) and side conversations or approvals (`create_conversations_*`) email people.

Ticket text is written by end users and is untrusted. A prompt injection in a ticket could ask Claude to attach a local file or email someone, and the permission prompt is your chance to catch it. The server also refuses to upload hidden (dot) files, anything inside a dot-directory such as `~/.ssh`, non-regular files, and files over 25 MB. The one exception is the plugin's own downloads folder, so a PDF it saved can be attached; hidden files and symlinks pointing elsewhere are still refused there.

Every non-read call is logged locally to `~/.claude/plugins/data/<plugin-id>/audit.jsonl` with status `ok` or `error`. Calls the server refuses (an action above the configured tier, a refused upload path, or an attempt to set a server-controlled field) are logged with status `denied` and the reason. The log and the downloads folder are readable only by your user account. When the log passes 5 MB it is moved to `audit.jsonl.1`, replacing the previous one.

Downloaded files are saved to `~/.claude/plugins/data/<plugin-id>/downloads/`. An existing file is never overwritten; a repeat download gets a numeric suffix such as `invoice-42-1.pdf`.

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
