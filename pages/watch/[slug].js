import Head from 'next/head';
import { listPosts } from '../../lib/siteDb';
import { slugFromKey } from '../../lib/slug';
import { formatDuration } from '../../lib/animeContent';

// Set this once the site's real domain is known — used to build the
// canonical URL, the OG "og:url" tag, and the "watch on the site" /
// "download" links back into the main S-E app's ?post=/?dl= views.
// Falls back to a relative link if it isn't set, so this still works
// (minus the canonical/og:url tag) even before it's configured.
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '');

// This is a PUBLIC page — no session check, on purpose: it's meant to be
// shared/crawled (WhatsApp, Twitter, Google, etc.), same as the site itself.
export async function getServerSideProps({ params }) {
  const { slug } = params;

  let post = null;
  try {
    const posts = await listPosts();
    post = posts.find((p) => slugFromKey(p.thumbnail_url) === slug) || null;
  } catch (err) {
    console.error('تعذر جلب المنشور لصفحة المشاركة:', err.message);
  }

  if (!post) {
    return { notFound: true };
  }

  return { props: { post } };
}

export default function WatchPage({ post }) {
  const title = post.title || '';
  const description = post.description || post.synopsis || '';
  const image = post.thumbnail_url || '';
  const slug = slugFromKey(post.thumbnail_url);

  const siteWatchUrl = SITE_URL ? `${SITE_URL}/?post=${slug}` : `/?post=${slug}`;
  const siteDownloadUrl = SITE_URL ? `${SITE_URL}/?dl=${slug}` : `/?dl=${slug}`;
  const canonicalUrl = SITE_URL ? `${SITE_URL}/watch/${slug}` : null;
  // Facebook builds the post preview from this public page's OG image/title.
  // Keep the actual publishing step in Facebook; this link only opens its composer.
  const facebookShareUrl = SITE_URL
    ? `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(canonicalUrl || siteWatchUrl)}`
    : null;

  return (
    <>
      <Head>
        <title>{title || 'S-E'}</title>
        {description ? <meta name="description" content={description} /> : null}

        <meta property="og:type" content="video.other" />
        <meta property="og:title" content={title} />
        {description ? <meta property="og:description" content={description} /> : null}
        {image ? <meta property="og:image" content={image} /> : null}
        {canonicalUrl ? <meta property="og:url" content={canonicalUrl} /> : null}

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        {description ? <meta name="twitter:description" content={description} /> : null}
        {image ? <meta name="twitter:image" content={image} /> : null}

        {canonicalUrl ? <link rel="canonical" href={canonicalUrl} /> : null}
      </Head>

      <main style={styles.main} dir="rtl">
        {image ? <img src={image} alt={title} style={styles.image} /> : null}
        <h1 style={styles.title}>{title}</h1>
        <div style={styles.meta}>
          {[post.studio, post.series, post.duration ? formatDuration(post.duration) : null]
            .filter(Boolean)
            .join(' · ')}
        </div>
        {description ? <p style={styles.description}>{description}</p> : null}
        <div style={styles.actions}>
          {facebookShareUrl ? (
            <a
              href={facebookShareUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.primaryBtn}
              aria-label="مشاركة المنشور على Facebook"
            >
              مشاركة المنشور
            </a>
          ) : null}
          {post.download_url ? (
            <a href={siteDownloadUrl} style={styles.secondaryBtn}>
              تحميل
            </a>
          ) : null}
        </div>
      </main>
    </>
  );
}

const styles = {
  main: {
    maxWidth: 640,
    margin: '0 auto',
    padding: '32px 20px',
    textAlign: 'center',
  },
  image: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    margin: '0 auto 20px',
    display: 'block',
  },
  title: { fontSize: 22, margin: '0 0 8px', color: '#fff' },
  meta: { color: '#a0a0a0', fontSize: 14, marginBottom: 14 },
  description: { color: '#c9c9c9', fontSize: 15, lineHeight: 1.7, marginBottom: 24 },
  actions: { display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' },
  primaryBtn: {
    background: '#ff4757',
    color: '#fff',
    padding: '12px 22px',
    borderRadius: 10,
    textDecoration: 'none',
    fontWeight: 600,
  },
  secondaryBtn: {
    background: '#262626',
    color: '#fff',
    padding: '12px 22px',
    borderRadius: 10,
    textDecoration: 'none',
    fontWeight: 600,
    border: '1px solid rgba(255,255,255,0.08)',
  },
};
