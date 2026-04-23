# Mail Organizer for OWA

Mail Organizer for OWA is a Chrome extension that injects a smart workflow panel into the native OWA mailbox. It helps users sort visible emails by urgency, archive category, and lightweight automation rules without leaving the original inbox UI.

## Features

- Detects emails that are currently visible in OWA
- Sorts by deadline signals, urgent wording, and manual high-priority overrides
- Groups emails into archive-style categories:
  - `高优先级`
  - `待处理`
  - `本周跟进`
  - `没用`
  - `已归档`
- Supports rule-based routing by sender, subject, or snippet keywords
- Includes a compact AI summary panel for the currently selected email only
- Provides a draggable floating launcher and a collapsible right sidebar
- Supports multiple UI themes with persisted selection

## Tech Stack

- React 18
- Vite
- Tailwind CSS
- Lucide React
- Chrome Extension Manifest V3
- Chrome Storage Sync
- MutationObserver-based DOM watching

## Supported URLs

- `https://mail.xjtlu.edu.cn/owa/*`
- `https://outlook.office.com/mail/*`
- `https://outlook.office365.com/mail/*`

## Local Development

1. Install dependencies:
   - `npm install`
2. Build the extension bundle:
   - `npm run build`
3. Open Chrome and go to `chrome://extensions/`
4. Enable `Developer mode`
5. Click `Load unpacked`
6. Select this project directory

After code changes:

1. Run `npm run build`
2. Click `Reload` on the extension in `chrome://extensions/`
3. Refresh the OWA tab

## Notes

- The extension only organizes emails that are currently rendered in the active OWA page
- It does not move or archive real server-side folders
- If Microsoft changes the OWA DOM structure, the selectors in the observer may need updates
- The AI summary panel is intentionally secondary to the archive workflow

## License

This project is released under the MIT License.
