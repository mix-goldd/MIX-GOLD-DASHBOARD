import Head from 'next/head';
import { listPosts } from '../../lib/siteDb';
import { slugFromKey } from '../../lib/slug';
import { formatDuration } from '../../lib/animeContent';
import { getDashboardSetting } from '../../lib/db';
import { findVidmolyLibraryMatch } from '../../lib/vidmolyLibraryMatch';

// Prefer the public site URL, then Vercel's production host, then the
// current request host. This keeps Facebook share links absolute in production.
const CONFIGURED_SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '');
const VERCEL_SITE_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';

function getRequestSiteUrl(req) {
  if (CONFIGURED_SITE_URL) return CONFIGURED_SITE_URL;
  if (VERCEL_SITE_URL) return VERCEL_SITE_URL;
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  const protocol = req?.headers?.['x-forwarded-proto'] || 'https';
  return host ? `${protocol}://${host}`.replace(/\/+$/, '') : '';
}

// This is a PUBLIC page — no session check, on purpose: it's meant to be
// shared/crawled (WhatsApp, Twitter, Google, etc.), same as the site itself.
export async function getServerSideProps({ params, req }) {
  const { slug } = params;

  let post = null;
  let vidmolyThumbnail = '';
  try {
    const posts = await listPosts();
    post = posts.find((p) => slugFromKey(p.thumbnail_url) === slug) || null;
    if (post?.type === 'video') {
      const storedSnapshot = await getDashboardSetting('vidmoly_library_snapshot_v1');
      const match = findVidmolyLibraryMatch(post.title, storedSnapshot?.payload || null);
      vidmolyThumbnail = match?.thumbnail_url || '';
    }
  } catch (err) {
    console.error('تعذر جلب المنشور لصفحة المشاركة:', err.message);
  }

  if (!post) {
    return { notFound: true };
  }

  return { props: { post, siteUrl: getRequestSiteUrl(req), vidmolyThumbnail } };
}

export default function WatchPage({ post, siteUrl, vidmolyThumbnail }) {
  const title = post.title || '';
  const description = post.description || post.synopsis || '';
  const image = vidmolyThumbnail || post.thumbnail_url || '';
  const slug = slugFromKey(post.thumbnail_url);

  const siteWatchUrl = siteUrl ? `${siteUrl}/?post=${slug}` : `/?post=${slug}`;
  const siteDownloadUrl = siteUrl ? `${siteUrl}/?dl=${slug}` : `/?dl=${slug}`;
  const canonicalUrl = siteUrl ? `${siteUrl}/watch/${slug}` : null;
  const shareDescription = [description, canonicalUrl || siteWatchUrl].filter(Boolean).join('\n\n');
  // Facebook builds the post preview from this public page's OG image/title.
  // Keep the actual publishing step in Facebook; this link only opens its composer.
  const facebookShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(canonicalUrl || siteWatchUrl)}`;

  return (
    <>
      <Head>
        <title>{title || 'S-E'}</title>
        {description ? <meta name="description" content={description} /> : null}

        <meta property="og:type" content="video.other" />
        <meta property="og:title" content={title} />
        {shareDescription ? <meta property="og:description" content={shareDescription} /> : null}
        {image ? <meta property="og:image" content={image} /> : null}
        {canonicalUrl ? <meta property="og:url" content={canonicalUrl} /> : null}

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        {shareDescription ? <meta name="twitter:description" content={shareDescription} /> : null}
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
          <a
            href={facebookShareUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={styles.primaryBtn}
            aria-label="مشاركة المنشور على Facebook"
          >
            مشاركة المنشور
          </a>
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
