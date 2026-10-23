# Using the board

Everything below works against the seeded demo data, with no setup beyond
`sh install.sh` and `node .`.

## Check the next sailing

1. Open `/`. The board shows today's service status, the next departures across
   all three piers and how many crossings each pier runs today.
2. Select **Open the timetable** (or `/timetable`). The URL normalises to
   `?pier=<first pier>&weekday=<today>` so the view is shareable.
3. Change the pier or weekday selector — the table reloads without a full page
   reload and the URL follows along.
4. A weekday with no sailings shows an empty state with a **Show today's
   sailings** shortcut.

Only active crossings appear here. An inactive sailing (for example the seeded
"MV Osprey (charter)") stays in the staff timetable but never reaches the public
board.

## Read disruption notices

- `/notices` lists every published notice, newest first, with a severity badge
  (Info / Warning / Critical) and the affected pier, or **All piers**.
- On `/timetable` the banner above the table shows only the notices that affect
  the selected pier: its own notices plus the all-pier ones. With nothing
  reported it says so and links to the full notice board.

## Request vehicle-deck space

1. Open `/book`.
2. Choose the pier and travel date. The departure list refreshes with the active
   sailings for that pier and weekday, and the first sailing is preselected.
3. Fill in the passenger, contact and vehicle details and send the request.
4. A success panel shows the booking reference (for example `FB-7K2Q`) and the
   Pending status. The request is stored immediately — reloading does not lose
   it.

Field errors appear next to the input that needs fixing, and the send button
cannot be double-submitted.

## Review requests as staff

1. Sign in at `/login` with `cenius@cenius.ai` / `cenius` (or use the demo card).
2. `/dashboard` greets you by name and counts pending requests, published
   notices and today's active crossings.
3. `/staff/bookings` lists requests newest first with status tabs and per-status
   counts. Select **Review** on a request.
4. On the request page, **Approve request** records you as the reviewer with a
   timestamp. **Decline request** requires a written reason — the reason,
   reviewer name and decision time then appear on the request.

A decided request cannot be decided twice; the API answers `409` if you try.

## Keep the timetable current

1. Go to `/staff/timetable`. Every crossing is listed, including inactive ones.
2. **New crossing** opens a form (pier, weekday, departure, arrival, vessel,
   vehicle capacity, active flag). New crossings are active by default and
   appear on the public timetable straight away.
3. **Edit** changes times, vessel or capacity. Arrival must be later than
   departure, and capacity must be positive.
4. **Deactivate** hides a sailing from the public timetable and from booking
   departures while keeping it on file. **Delete** asks for confirmation first.

## Author notices

1. Go to `/staff/notices` — every notice including drafts.
2. **Write a notice** opens the form: title, text, severity, affected pier (or
   All piers) and publication state. Drafts stay internal.
3. **Publish** on the list flips a draft live immediately; **Unpublish** takes
   it back down. Your name is recorded as the author.

## Sign out

**Sign out** in the header ends the server-side session and returns you to the
signed-out login state.
