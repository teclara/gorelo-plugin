---
name: gorelo-log-time
description: Log time entries in Gorelo from plain language ("1.5h on the Acme printer ticket", "log my day"). Resolves the ticket or task, work type and billing role, confirms, then creates the entries. Requires the write tier.
---

# Log time in Gorelo

1. **Parse** each entry from the user's text: duration, when it happened, the client or ticket reference, and the note.
2. **Resolve IDs.** Never guess them.
   - Ticket: the ID is a UUID, not the ticket number people quote. Call `gorelo_tickets.list` with `Query`, which matches the title, the number and the display number, so it works for "1042" as well as for "printer". Add `ClientIds` to narrow by client. Check the `DisplayNumber` of each match, ask if more than one fits, and keep the ticket's `Id`. Use `gorelo_tickets.get` only when you already have that UUID, passed as `ticketId`.
   - Task: find the project with `gorelo_projects.list` (`Query` or `ClientIds`), then call `gorelo_project_tasks.list` with the project's `Id` as `projectId`. Task IDs are UUIDs too.
   - Work type: use `gorelo_billing_reference.list_work_types`.
   - Billing role: use `gorelo_billing_reference.list_billing_roles`.
   - User: use `gorelo_organization.list_users`. Default to the user the person says they are, and ask once if unknown.
3. **Confirm.** Show a table of the entries: ticket or task, start, duration, work type, billing role, note. Wait for a yes.
4. **Create.** Call `gorelo_time_entries_write.create` once per entry. The body takes:
   - `TicketId` or `TaskId`: exactly one of them.
   - `UserId`.
   - Two of `StartedOn`, `EndedOn` and `ActualHours` (decimal hours). Gorelo works out the third. Times are UTC.
   - `WorkTypeId`, `BillingRoleId` and `Comment` when you have them. Without the first two, Gorelo uses the ticket's defaults.
5. **Report.** Give the created entry IDs. If any entry failed, say which one and why, and don't retry silently.

If the `gorelo_time_entries_write` tool is missing, the plugin is on the read tier. Tell the user to switch "Access tier" to write in `/plugin`.
