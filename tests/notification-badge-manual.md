# iPhone PWA badge verification

Automated checks: `FAKE_INDEXEDDB_MODULE=/path/to/fake-indexeddb/build/esm/index.js node tests/notification-badge.test.mjs`.
These run the actual worker/page scripts with IndexedDB emulation and mocked OS APIs; they do not send real Push messages.

## Device check (after deployment)

1. On an iPhone supporting Web Push/Badging, add the portal to the Home Screen, allow notifications, and enable Badges in the app's iOS notification settings.
2. Open the portal home once and confirm the updated worker uses `staff-portal-v95`. Background the PWA.
3. Send an existing application notification. Confirm the notification arrives unchanged and the icon shows 1. Send two more; confirm 2 then 3.
4. Tap a notification with an application URL. Confirm that URL opens, including when another portal screen is already open, and that the badge disappears.
5. Receive another Push. Launch the PWA normally and reach home; confirm the badge clears. Also check returning from the background to home.
6. Check submitted/approved/revision-required/rejected application notifications, today/tomorrow schedule notifications, and overdue reminders still arrive with their original text and destinations.
7. On an unsupported browser or with badge display disabled, confirm normal notifications/navigation work without an uncaught error.
8. Confirm the home administration menu's approval-pending count is unchanged.

## Semantics and limits

- IndexedDB `staff-portal-notification-badge`, store `state`, key `unread`, holds a count per browser/PWA storage. It is not synchronized across devices or an authoritative server unread list.
- Every received Push increments it. Notification tap or visible home-page entry/resume acknowledges all notifications and resets it to zero. Dismissing a notification alone does not reset it.
- Home sends a message to the worker, which serializes increments, resets, and badge API calls. No localStorage or server table changes are needed.
- OS badge permissions remain under user control. Storage/API failure never blocks the normal notification; unavailable storage may prevent an accurate count. Clearing browser data resets the stored count.
- This counter is separate from approval-pending counts. No sending conditions, recipients, subscriptions, or delivery-history records are modified.

Platform reference: https://webkit.org/blog/14112/badging-for-home-screen-web-apps/
