# Facebook Pages API research

## Official sources

1. Meta Pages API Posts: https://developers.facebook.com/documentation/pages-api/posts
2. Meta Pages API Overview: https://developers.facebook.com/documentation/pages-api/overview
3. Meta Access Tokens: https://developers.facebook.com/documentation/facebook-login/guides/access-tokens
4. Meta Permissions Reference: https://developers.facebook.com/docs/permissions/

## Findings

Meta's Pages API publishes a Page post through `POST /{page_id}/feed` with `message`, optional `link`, and `published=true`. Photo posts use `POST /{page_id}/photos` with a public image URL; video publishing follows the Video API documentation.

The official flow is Facebook Login for Business, then query `/me/accounts` to obtain each Page ID and its Page access token. Page access tokens can read, write, and modify Page data and must remain server-side.

For publishing Page content, Meta's current Posts guide lists `pages_manage_posts`, `pages_read_engagement`, `pages_manage_engagement`, and `pages_read_user_engagement`; it additionally lists `publish_video` when publishing a video. The app user must have Page tasks including `CREATE_CONTENT`, and commonly `MANAGE`/`MODERATE` depending on operations.

Meta states that Page-related permissions require App Review for live apps, while development mode can request permissions from users who have a role on the app. The implementation must not expose app secrets, user tokens, or Page tokens to the browser.

## Consequence for this project

The project needs a Meta app ID and app secret, an OAuth callback URL registered in Meta, and a user with access to the target Page. The safest first implementation is server-side OAuth, server-side Page list retrieval, encrypted/server secret storage, a Page selector, and a publish endpoint that sends only the selected post's text/link/image to Graph API after explicit user confirmation.
