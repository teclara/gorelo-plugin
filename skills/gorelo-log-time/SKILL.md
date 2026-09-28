---
name: gorelo-log-time
description: Log time entries in Gorelo from plain language ("1.5h on the Acme printer ticket", "log my day"). Resolves the ticket or task, work type and billing role, confirms, then creates the entries. Requires the write tier.
---

# Log time in Gorelo

1. **Parse** each entry from the user's text: duration, when it happened, the client or ticket reference, and the note.
2. **Resolve IDs.** Never guess them.
   - Ticket: use `gorelo_tickets.list` with `Query` or `ClientIds`, or `gorelo_tickets.get` if the user gave a number.
   - Task: use `gorelo_project_tasks.list` on the right project, found through `gorelo_projects.list`.
   - Work type: use `gorelo_billing_reference.list_work_types`.
   - Billing role: use `gorelo_billing_reference.list_billing_roles`.
   - User: use `gorelo_organization.list_users`. Default to the user the person says they are, and ask once if unknown.
3. **Confirm.** Show a table of the entries: ticket or task, start, duration, work type, billing role, note. Wait for a yes.
4. **Create.** Call `gorelo_time_entries_write.create` once per entry. Use the exact body fields from the tool schema.
5. **Report.** Give the created entry IDs. If any entry failed, say which one and why, and don't retry silently.

If the `gorelo_time_entries_write` tool is missing, the plugin is on the read tier. Tell the user to switch "Access tier" to write in `/plugin`.
