# Vidmoly Portal Sync — Verified Integration Notes

## Verified endpoints

| Purpose | Method | URL | Authentication | Safe fields used |
| --- | --- | --- | --- | --- |
| Create a temporary portal session | `POST` | `https://vidmoly.me/api/auth/login` | JSON `{ login, password }` | HTTP status and session cookie only |
| Read API quota for the authenticated portal account | `GET` | `https://vidmoly.me/api/user/api-key` | `vidmoly_session` cookie | `apiDailyLimit`, `apiUsedToday`, `apiRemainingToday`, `apiUnlimited` |
| Portal settings page used for route discovery | `GET` | `https://vidmoly.me/user/settings` | `vidmoly_session` cookie | None at runtime |

## Implementation constraints

The quota endpoint response can include an API key. The production synchronizer must use it only in memory to match the response to the configured server-side Vidmoly key, then discard it. It must never return, log, persist, or expose that value.

The endpoint was verified with five authorized portal sessions. Each valid session returned an integer daily limit and integer daily usage. The stored portal sessions should be mapped dynamically to configured account identifiers (`vidmoly-1` through `vidmoly-5`) by exact in-memory key equality, never by a supplied email address or a hard-coded position.

The automatic job must be idempotent and record only safe operational metadata: last attempt time, last successful sync time, generic failure state, and matched account identifiers. It must not store portal credentials, session cookies, raw provider payloads, or API keys.

## Live synchronization snapshot

The integration test completed successfully on 15 August 2026. This is an operational snapshot only; the dashboard status API is the source of truth because values change during the UTC day.

| Configured account | Used today | Daily limit | Source |
| --- | ---: | ---: | --- |
| Vidmoly 1 | 49 | 50 | Provider portal |
| Vidmoly 2 | 32 | 50 | Provider portal |
| Vidmoly 3 | 32 | 50 | Provider portal |
| Vidmoly 4 | 32 | 50 | Provider portal |
| Vidmoly 5 | 31 | 50 | Provider portal |

The test also confirmed a one-to-one portal-to-account match for all five configured account identifiers. No login, password, session value, API key, or email address is included in this record.

## Sources

- [Vidmoly login endpoint](https://vidmoly.me/api/auth/login)
- [Vidmoly portal API-key usage endpoint](https://vidmoly.me/api/user/api-key)
- [Vidmoly settings page](https://vidmoly.me/user/settings)
