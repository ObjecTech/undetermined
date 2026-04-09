# Mail Organizer for OWA

This is a Chrome extension for organizing emails directly inside the OWA web interface. It is designed to do three things well:

- Automatically archive visible emails into different categories
- Move important emails to the top based on deadlines, urgent wording, and manual priority overrides
- Provide a small AI summary panel as a secondary helper for the currently selected email

## Current Features

- Extracts emails that are currently rendered on the OWA page
- Supports custom archive categories
- Supports automatic rules such as:
  - sender contains a keyword -> move to a category
  - subject contains a keyword -> move to a category
  - snippet contains a keyword -> move to a category
- Supports manual overrides per email:
  - archive category
  - priority
  - due date
- Built-in sorting logic:
  - manually marked high priority
  - near deadline / urgent wording
  - follow-up this week
  - normal emails
- Lets you click a card in the panel to focus the original email row in OWA
- Includes a compact AI summary panel using a DeepSeek OpenAI-compatible endpoint in the background

## Installation

1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable Developer Mode
4. Click `Load unpacked`
5. Select this directory

## Notes

- This extension does not directly change real folders or archive state on the mail server
- It only organizes emails that are currently visible in the loaded OWA page
- If the OWA DOM changes significantly, the selectors may need to be updated
- AI summary is a helper feature only and does not affect the main archive workflow
