# 🧹 GitHub Notification Cleaner

A Chrome extension that bulk-marks non-open GitHub notification items as **Done** with one click — so you can focus on what still needs your attention.

## Install

**[Get it on the Chrome Web Store →](https://chromewebstore.google.com/detail/github-notification-clean/omajljhnaplohaabpmihcldkeleeoodg)**

## What it does

GitHub's notification inbox fills up with PRs and issues that have already been merged, closed, or are still in draft. Clearing them manually is tedious — you have to check each one and click Done, page after page.

**GitHub Notification Cleaner** automates this. Navigate to your [GitHub notifications](https://github.com/notifications) page, open the extension popup, and click **Clean Notifications**. It will:

1. **Scan** every notification on the current page.
2. **Select** items matching the statuses you chose (merged, closed, and/or draft).
3. **Click Done** on all selected items at once.
4. **Automatically paginate** through all your notification pages until everything is cleaned.

### Configurable filters

Choose which notification types to clean:

| Status | Color | Default |
|--------|-------|---------|
| 🟣 Merged | Purple | ✅ On |
| 🔴 Closed | Red | ✅ On |
| ⚫ Draft | Gray | ✅ On |

Open (green) notifications are always left untouched.

## Permissions

| Permission | Why |
|------------|-----|
| `activeTab` | Access the current GitHub notifications tab |
| `scripting` | Inject the cleanup script into the page |
| `tabs` | Navigate between notification pages |

The extension only runs when you click the button, only operates on `github.com/notifications` pages, and does not collect or transmit any data.
