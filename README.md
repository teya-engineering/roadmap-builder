# 🗺️ Roadmap Generator

A JavaScript interface for generating professional team roadmaps from structured data. Create beautiful, interactive Gantt-style roadmaps with timeline change tracking.

## Features

- **Dynamic Layout**: Automatically scales to any number of EPICs and stories
- **Timeline Changes**: Track and display timeline slips with detailed explanations
- **Professional Styling**: Clean, modern design with alternating swimlane colors
- **Flexible Sizing**: Story boxes automatically resize based on content
- **Browser & Node.js Compatible**: Works in both environments
- **Easy Integration**: Simple JavaScript API

## Running

```bash
npm start   # serves web/ on http://localhost:8080
```

### Environment variables

| Variable | Default   | Description                                                       |
| -------- | --------- | ----------------------------------------------------------------- |
| `PORT`   | `8080`    | Port to listen on.                                                |
| `HOST`   | `0.0.0.0` | Bind address. Set `127.0.0.1` to keep the dev server off the LAN. |

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

## Development

```bash
npm test          # run the unit + server tests (node:test)
npm run lint      # eslint
npm run format    # prettier --write
npm run typecheck # tsc --noEmit
```
