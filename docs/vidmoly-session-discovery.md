# Vidmoly Session Discovery

- Date: 2026-08-15
- Source: authenticated Vidmoly dashboard at `https://vidmoly.me/my`.
- The provided session authenticated successfully as the account shown as `MIX-GOLD-10`.
- The dashboard exposes a settings link at `https://vidmoly.me/user/settings`.
- The authenticated dashboard page does not expose a daily API request usage counter in its rendered content.

The API Settings section at `https://vidmoly.me/user/settings` visibly provides the daily quota, current used count, and remaining count for the authenticated account. The count is rendered in the page content, but the underlying supported data request must still be identified before automating synchronization. No API key value is recorded in this document.

The authenticated first-party endpoint is `GET /api/user/api-key`. Its response has the fields `apiDailyLimit`, `apiUsedToday`, `apiRemainingToday`, and `apiUnlimited`. The endpoint requires the account's authenticated browser session; no credential values, cookies, or API-key values are recorded here.
