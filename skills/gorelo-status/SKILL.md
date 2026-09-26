---
name: gorelo-status
description: Check that the Gorelo plugin is connected, which region and access tier it uses, and which resources the API key can reach. Use when the user asks if Gorelo is set up or working, or after a 401/403 error.
---

# Gorelo status

1. Call `gorelo_organization.list_users` with `{"limit": 1}`.
   - If the only tool is `gorelo_setup`, call it and relay the message, then tell the user to run `/plugin`, select gorelo-plugin and fill in the API key, region and access tier.
   - 401: the key is wrong or belongs to the other region. Say which base URL the error names.
2. Probe read access with `limit: 1` on each of: `gorelo_clients.list`, `gorelo_tickets.list`, `gorelo_assets.list_agents`, `gorelo_uptime.list`, `gorelo_time_entries.list`, `gorelo_invoices.list`, `gorelo_projects.list`. Record OK or 403 for each.
3. Report as a short table: resource and whether it's reachable. Also report the access tier, inferred from which tools exist: `gorelo_admin` present means full; `create` actions present means write; otherwise read.
4. If any resource is 403, suggest adding that scope to the key in Gorelo. If the tier is higher than the key's scopes allow, mention that the key is the real limit.
