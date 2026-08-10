# Sync controls — design

**Date:** 2026-08-10
**Status:** approved, not implemented
**Extends:** `2026-08-10-supabase-sync-design.md`, which put one account control in
the date header and explicitly rejected a manual pull. Both of those decisions are
revised here, and the reasons they were made are still worth reading.

## Goal

Two things, from one change:

- The account controls stop costing the tank a permanent row of chrome.
- Sync becomes something you can *see*, rather than something you hope is happening.

## What changed since the original decision

The sync spec rejected a manual pull as "least surprising, most friction, and easy to
forget". That reasoning treated the button as a *mechanism* — a way to move data,
competing with the wake triggers, which are better at it.

The button being added here is not a mechanism. It is a way to ask a question. Sync
works; what is missing is any way to know that it worked. A tank that silently agrees
with the server and a tank that has been failing for two days look identical, and the
only affordance that distinguished them was a banner that stays quiet by design.

So the button is secondary. **The timestamp is the feature** — it answers the question
before you tap anything — and the button exists so that the answer can be refreshed
on demand.

## Placement

### The account controls move into the Settings sheet

`AccountButton` leaves `DateHeader` entirely, along with the `account` snippet prop
and the `.account-row` rule added for it. The header returns to the single row it was
before sync existed, and every user who never signs in gets that vertical space back.

A new **Sync** section sits below the existing Tank section:

```
Tank
  ( ) Progress
  (•) Calm
  Show the legend again

Sync
  someone@example.com
  Synced 3 minutes ago            [ Sync now ]
  Sign out
```

Signed out, the section is one line: "Sign in to sync". Unconfigured — no
`PUBLIC_SUPABASE_URL` — the section does not render at all, exactly as the header
control does not today.

**The accepted cost:** "am I signed in?" now takes two taps. Sign-in happens once per
device and sign-out almost never; a permanent control for a twice-a-year action was
the wrong trade for an app whose entire interface is a picture.

## The timestamp

### It is held in memory, and deliberately not persisted

"When did *this device* last sync" is device-local, and the only thing this app
persists is `Snapshot` — which is precisely what syncs. Storing it there would
replicate it: the laptop would display the phone's sync time, and last-write-wins
would arbitrate a field that is meaningless to the other side. A second storage key
would avoid that and break the rule that `persist/` is the only layer that knows
where data lives.

So `SyncingTaskStore` holds it. A successful sync stamps it, and the existing status
callback carries it up. Nothing new is persisted, nothing new is synced, and the value
cannot be wrong about whose device it describes.

The cost is that a reload blanks it. That is acceptable and must be stated honestly
rather than papered over: a reload *starts* a sync, so the blank state lasts seconds.

`SyncStatus` gains one optional field:

```ts
export type SyncStatus = {
  state: 'idle' | 'syncing' | 'offline' | 'denied' | 'stale' | 'skewed' | 'storage' | 'rejected';
  /** When this device last synced successfully. Absent until one has. */
  at?: number;
};
```

### What it says

| Situation | Line |
| --- | --- |
| No sync yet this session | Not synced yet |
| In flight | Syncing… |
| Just succeeded | Synced just now |
| Succeeded a while ago | Synced 3 minutes ago |
| Failing, never succeeded here | Not syncing — offline |
| Failing, succeeded earlier | Not syncing — offline. Last synced 20 minutes ago. |

The last row is the most valuable line in this design: it says both what is wrong and
how stale the tank is. A failure message without the timestamp leaves the second
question unanswered, which is the question that actually matters.

The relative formatting is a pure function.

### Sync now

Calls the same `sync()` the wake events call. One path, so the manual route cannot
drift from the automatic one. Disabled while a sync is in flight.

## What escapes the sheet

Hiding the controls means a failure could otherwise go unnoticed forever, so three
states raise the existing banner — the same surface `saveFailed` already uses:

- `denied` — sign in again
- `stale` — this device is out of date
- `rejected` — the server refused this data

These share one property: **they will never fix themselves.**

**Silent on the tank:** `offline`. A phone loses signal constantly and recovers on its
own. Nagging about it trains the user to ignore the banner, which costs them the three
states above. Visible in Settings, not over the tank.

**Settings only:** `skewed`. It will not self-resolve, but sync is still working — it
is ordering unreliably. A banner would overstate it.

**Precedence:** if `saveFailed` and a sync failure are both live, `saveFailed` wins.
Local storage failing is strictly worse than the cloud failing, and two banners
stacked over an aquarium is noise.

## Testing

- **The formatter**, as a pure function, boundaries included: under a minute, exactly
  a minute, hours, and absent. Boundaries are where relative-time code always breaks.
- **`SyncStatus` carrying `at`**: stamped on success, and — the case worth writing —
  *preserved through a subsequent failure*, so the "last synced 20 minutes ago" line
  is real rather than blank at the moment it matters most.
- **Banner mapping**: the three permanent states raise it; `offline` and `skewed` do
  not; `saveFailed` outranks all of them.
- **E2E**: the existing unconfigured assertion retargets from the header button to the
  Settings section, and gains a check that the header renders no account row at all.
  With `E2E_EXPECT_SYNC=1`, open Settings and assert the section is present.
- **Looked at, not reasoned about**: the Settings sheet signed in, with a long email
  and the longest failure line, at 420×860 and narrower. The previous placement bug in
  this feature was a layout collision that no test could catch, and this change puts
  variable-length text into a fixed-width sheet.

## Out of scope

Reporting *what* a sync brought in ("2 tasks arrived"). It is the strongest trust
signal available and it requires the merge to report its changes up through the store
— a larger change than this one, and worth doing separately if the timestamp turns out
to be insufficient.

Persisting the last-sync time across reloads. Deliberate; see above.
