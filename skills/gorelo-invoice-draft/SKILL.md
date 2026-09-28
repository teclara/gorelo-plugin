---
name: gorelo-invoice-draft
description: Draft a manual Gorelo invoice for a client and period from billable time, items and contract lines. Always creates a Draft for human review; never approves. Requires the write tier.
---

# Draft an invoice

1. **Client and period.** Resolve the client with `gorelo_clients.list` (`Query`). Confirm the period, for example "September 2026".
2. **Gather the inputs:**
   - `gorelo_time_entries.list` with `ClientIds`, `StartedSince` and `StartedBefore`. Keep entries whose `BillableStatus` (an `{Id, Name}` object on each returned entry) marks them billable.
   - `gorelo_invoices.list` with `ClientIds` and invoice dates covering the period, to see what has already been invoiced.
   - `gorelo_contracts.list` for the client, and `gorelo_contracts.get` for the active ones. Contract-generated invoices already cover their service lines.
   - `gorelo_items.list` for catalogue prices, and `gorelo_billing_reference.list_taxes` for tax IDs.
3. **Warn about double billing.** Manual invoice lines cannot link to time entries, so Gorelo will not mark this time as invoiced. Tell the user this, and point out any overlap with the existing invoices found in step 2.
4. **Propose lines.** Show a table: catalogue item, description, quantity, unit price, tax, and line total, plus the grand total. Group time by work type or ticket, whichever the user prefers. Each line in the `gorelo_invoices_write.create` schema needs:
   - `ItemId`: the UUID of a catalogue item from `gorelo_items.list`. It is required even for time, so bill labour against a labour or service item. If no suitable item exists, stop and ask; creating one needs the full tier.
   - `Quantity`: required, and greater than 0 (hours for labour).
   - Optional: `Description` (defaults to the item's name), `UnitPrice` (defaults to the item's price), `TaxId` (defaults to the item's tax; send `null` for no tax), `DiscountPercent`, and `BillableStatusId`.
5. **Create.** After a yes, call `gorelo_invoices_write.create` with `ClientId` and `LineItems`, plus `InvoiceDate`, `DueDate` and `Reference` if given. The server forces Draft status.
6. **Report.** Give the invoice ID and tell the user to review and approve it in Gorelo. Offer `gorelo_invoices.pdf` to download a copy.
