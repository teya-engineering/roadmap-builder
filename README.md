# 🗺️ Roadmap Generator

A JavaScript interface for generating professional team roadmaps from structured data. Create beautiful, interactive Gantt-style roadmaps with timeline change tracking.

## Features

- **Dynamic Layout**: Automatically scales to any number of EPICs and stories
- **Timeline Changes**: Track and display timeline slips with detailed explanations
- **Professional Styling**: Clean, modern design with alternating swimlane colors
- **Flexible Sizing**: Story boxes automatically resize based on content
- **Browser & Node.js Compatible**: Works in both environments
- **Easy Integration**: Simple JavaScript API
- **Slack notifications**: Posts a summary of what changed to a Slack channel on save

## Running

```bash
npm start   # serves web/ on http://localhost:8080
```

### Environment variables

| Variable            | Default   | Description                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`              | `8080`    | Port to listen on.                                                                                                                                                                                                                                                                                                                                    |
| `HOST`              | `0.0.0.0` | Bind address. Set `127.0.0.1` to keep the dev server off the LAN.                                                                                                                                                                                                                                                                                     |
| `SLACK_WEBHOOK_URL` | _(unset)_ | Slack [incoming webhook](https://api.slack.com/messaging/webhooks) URL. When set, each roadmap save posts a summary of what changed to that channel. **Leave unset to disable** - the feature is a silent no-op. Set it in the deployment/runtime environment (e.g. the container env), not as a build arg, so the secret never ships to the browser. |

## UI components

Native form controls are drawn by the OS, so a `<select>` popup, a checkbox and
a date picker cannot be themed and look wrong next to the rest of the app - and
wrong again in dark mode. `web/components/` replaces them:

| Component      | What it does                                            |
| -------------- | ------------------------------------------------------- |
| Select         | Button plus a listbox popup, with keyboard support      |
| Search field   | Text filter with a magnifier and a clear button         |
| Number field   | Native spinners swapped for steppers that match the app |
| Checkbox/radio | Restyled in place, pure CSS                             |

Nothing is rewritten in the views. Each component **wraps** the native element
and leaves it in the DOM as the source of truth, so `getElementById(id).value`,
inline `onchange` attributes and `addEventListener('change')` all keep working.
The select also hooks its `value` property, because code that assigns `.value`
fires no event and the visible label would otherwise go stale.

Most of the app's markup is built with `innerHTML` at runtime, so
`web/components/index.js` upgrades controls from a `MutationObserver` rather
than from a call at each render site. Anything that appears in the DOM is
upgraded once and marked; the rendered roadmap is skipped, since it holds no
form controls and is rebuilt on almost every keystroke.

Styling lives in `web/components/components.css` and uses only the design
tokens from `web/styles.css`, which is what keeps both themes consistent.

## Slack notifications

On save, the builder diffs the roadmap against its last-saved state and posts a
summary of **what changed** to a Slack channel. There is no server-side
persistence - roadmaps are saved to the user's local disk - so the diff is
computed in the browser and the message is sent through a thin same-origin
proxy.

### How it flows

1. A save fires the `roadmap:saved` event (manual save, or a debounced
   auto-save).
2. `web/views/builder/slack-notify.js` diffs the current team data against an
   in-memory **baseline** (the data as of the last notify or the most recent
   file load) and builds the message.
3. The browser POSTs `{ text }` to `POST /api/roadmap-saved` (same origin).
4. `server.mjs` forwards it to the `SLACK_WEBHOOK_URL` incoming webhook. The
   webhook URL is only ever held server-side.

### What it reports

The diff matches stories by `storyId` and reports, per story:

| Line            | Emoji                  | Trigger                                                                                                                    |
| --------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| End-date move   | `:calendar:`           | a story's `endDate` changed (`End date moved 15 May → 30 May`)                                                             |
| Status change   | `:loudspeaker:`        | a status flag flipped (e.g. `At Risk` / `No longer At Risk`, `Marked Done`, `Cancelled`, `Proposed`, `Transferred In/Out`) |
| Changelog entry | `:memo:`               | new entries added to the story's timeline-change log                                                                       |
| Footer          | `:bust_in_silhouette:` | EM · PM · save timestamp                                                                                                   |

### Triggering and coalescing

- **Manual save** → posts immediately.
- **Auto-save** (debounced ~1.5s while typing) → coalesced: the first auto-save
  arms a timer and the message is sent when it fires, diffing baseline → latest,
  so a burst of edits collapses into one message. The window is `COALESCE_MS`
  (5 minutes) in `web/views/builder/slack-notify.js`.

### Reliability and security

- **Best-effort, silent**: the local disk save always succeeds regardless. A
  missing webhook or a failed POST is logged to the console only - never blocks
  the save and never shown to the user.
- The webhook URL is read at request time and never sent to the browser; the
  endpoint is same-origin (no CORS), rejects non-`POST`, and caps the body at
  64 KB.

Cross-team overlap notifications are not implemented. They can reuse the matching logic in `web/utilities/imo-utility.js` when added.

## Development

```bash
npm test          # run the unit + server tests (node:test)
npm run lint      # eslint
npm run format    # prettier --write
npm run typecheck # tsc --noEmit
```

The notification feature is covered by:

- `web/domain/roadmap-diff.test.js` - the diff engine
- `web/domain/slack-message.test.js` - the Slack message formatter
- `web/views/builder/slack-notify.test.js` - baseline tracking, coalescing, and
  best-effort delivery
- `server.test.mjs` - the `/api/roadmap-saved` proxy (forwarding, validation,
  status codes)
