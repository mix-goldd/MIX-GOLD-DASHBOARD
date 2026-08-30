import Head from 'next/head';
import { listPosts } from '../../lib/siteDb';
import { slugFromKey } from '../../lib/slug';
import { formatDuration } from '../../lib/animeContent';
import { getDashboardSetting } from '../../lib/db';
import { findVidmolyLibraryMatch } from '../../lib/vidmolyLibraryMatch';

const CONFIGURED_SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '');
const CANONICAL_SITE_URL = 'https://mix-goldd.vercel.app';

function getRequestSiteUrl() {
  return CONFIGURED_SITE_URL || CANONICAL_SITE_URL;
}

export async function getServerSideProps({ params, req }) {
  const { slug } = params;
  let post = null;
  let vidmolyThumbnail = '';
  try {
    const posts = await listPosts();
    post = posts.find((item) => slugFromKey(item.thumbnail_url) === slug) || null;
    if (post?.type === 'video') {
      const storedSnapshot = await getDashboardSetting('vidmoly_library_snapshot_v1');
      const match = findVidmolyLibraryMatch(post.title, storedSnapshot?.payload || null);
      vidmolyThumbnail = match?.thumbnail_url || '';
    }
  } catch (err) {
    console.error('تعذر جلب المنشور العام:', err.message);
  }

  if (!post) return { notFound: true };
  return { props: { post, siteUrl: getRequestSiteUrl(req), vidmolyThumbnail } };
}

export default function PublicPostPage({ post, siteUrl, vidmolyThumbnail }) {
  const title = post.title || '';
  const description = post.description || post.synopsis || '';
  const image = vidmolyThumbnail || post.thumbnail_url || '';
  const slug = slugFromKey(post.thumbnail_url);
  const publicPostUrl = siteUrl ? `${siteUrl}/Watch/${slug}` : `/Watch/${slug}`;
  const shareDescription = [description, publicPostUrl].filter(Boolean).join('\n\n');
  const facebookShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(publicPostUrl)}`;

  return (
    <>
      <Head>
        <title>{title || 'MIX GOLD'}</title>
        {description ? <meta name="description" content={description} /> : null}
        <meta property="og:type" content="article" />
        <meta property="og:title" content={title} />
        {shareDescription ? <meta property="og:description" content={shareDescription} /> : null}
        {image ? <meta property="og:image" content={image} /> : null}
        <meta property="og:url" content={publicPostUrl} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        {shareDescription ? <meta name="twitter:description" content={shareDescription} /> : null}
        {image ? <meta name="twitter:image" content={image} /> : null}
        <link rel="canonical" href={publicPostUrl} />
      </Head>

      <main style={styles.main} dir="rtl">
        {image ? <img src={image} alt={title} style={styles.image} /> : null}
        <h1 style={styles.title}>{title}</h1>
        {description ? <p style={styles.description}>{description}</p> : null}
        <a href={publicPostUrl} style={styles.link}>{publicPostUrl}</a>
        <div style={styles.meta}>
          {[post.studio, post.series, post.duration ? formatDuration(post.duration) : null].filter(Boolean).join(' · ')}
        </div>
        <div style={styles.actions}>
          <a href={facebookShareUrl} target="_blank" rel="noopener noreferrer" style={styles.primaryBtn} aria-label="مشاركة المنشور على Facebook">
            مشاركة المنشور
          </a>
        </div>
      </main>
    </>
  );
}

const styles = {
  main: { maxWidth: 640, margin: '0 auto', padding: '32px 20px', textAlign: 'center' },
  image: { width: '100%', maxWidth: 360, borderRadius: 16, margin: '0 auto 20px', display: 'block' },
  title: { fontSize: 22, margin: '0 0 22px', color: '#fff' },
  description: { color: '#c9c9c9', fontSize: 15, lineHeight: 1.7, margin: '0 0 22px', whiteSpace: 'pre-line' },
  link: { display: 'block', color: '#4da3ff', fontSize: 14, lineHeight: 1.6, marginBottom: 16, wordBreak: 'break-all' },
  meta: { color: '#a0a0a0', fontSize: 14, marginBottom: 14 },
  actions: { display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' },
  primaryBtn: { background: '#ff4757', color: '#fff', padding: '12px 22px', borderRadius: 10, textDecoration: 'none', fontWeight: 600 },
};
