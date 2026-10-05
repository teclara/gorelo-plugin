---
name: gorelo-uptime-maintenance
description: Put Gorelo uptime checks into or out of maintenance mode for a time window ("put Acme's checks in maintenance tonight 8–10pm"). Also lists failing checks. Requires the write tier.
---

# Uptime maintenance

1. **Find checks.** Call `gorelo_uptime.list`. Narrow it with `ClientIds` (resolve the client first with `gorelo_clients.list` and `Query`) or with `Query`, which matches the check description. Show the matches and confirm which ones are meant.
2. **Work out the window.** Build `MaintenanceMode` from the user's request:
   - `Enabled: true`
   - `StartDateTime` in UTC, converted from the user's local time. State the conversion you used.
   - `DurationInMinutes`. `0` means maintenance never ends on its own, so avoid it unless the user asks for "until I turn it off".
   - `Reason`
3. **Confirm.** Show the checks, the window in local time and in UTC, and the reason. Wait for a yes.
4. **Apply.** Call `gorelo_uptime_write.update` for each check with `checkId` and a body containing only `MaintenanceMode`.
5. **To end maintenance early,** show which checks will leave maintenance mode and wait for a yes. Then call `gorelo_uptime_write.update` for each with `checkId` and a body containing only `MaintenanceMode: {"Enabled": false}`.
6. **Verify.** Call `gorelo_uptime.get` on one of the checks and confirm that `MaintenanceMode` matches.
