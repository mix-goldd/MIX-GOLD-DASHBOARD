import Head from 'next/head';
import { useState } from 'react';
import { buildShareText } from '../../lib/sharePost';
import { listPosts } from '../../lib/siteDb';
import { slugFromKey } from '../../lib/slug';
import { formatDuration } from '../../lib/animeContent';
import { getDashboardSetting } from '../../lib/db';
import { findVidmolyLibraryMatch } from '../../lib/vidmolyLibraryMatch';

// Use the configured public domain, never Vercel's temporary deployment host.
const CONFIGURED_SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '');
const CANONICAL_SITE_URL = 'https://mix-goldd.vercel.app';

function getRequestSiteUrl() {
  return CONFIGURED_SITE_URL || CANONICAL_SITE_URL;
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
  const canonicalUrl = siteUrl ? `${siteUrl}/post/${slug}` : `/post/${slug}`;
  const shareDescription = [description, canonicalUrl || siteWatchUrl].filter(Boolean).join('\n\n');
  const shareText = buildShareText({ title, description, url: canonicalUrl || siteWatchUrl });
  const [shareState, setShareState] = useState('');

  async function sharePost() {
    setShareState('');
    try {
      const isDesktop = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches;
      if (isDesktop) {
        const facebookShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(canonicalUrl || siteWatchUrl)}&quote=${encodeURIComponent(shareText)}`;
        const shareWindow = window.open(facebookShareUrl, '_blank', 'noopener,noreferrer');
        setShareState(shareWindow ? 'تم فتح Facebook مع نص المنشور؛ ستظهر صورة Vidmoly من رابط المنشور.' : 'اسمح بالنوافذ المنبثقة لفتح Facebook.');
        return;
      }

      let files = [];
      if (image && typeof window !== 'undefined') {
        const imageResponse = await fetch(`/api/share-image?url=${encodeURIComponent(image)}`);
        if (imageResponse.ok) {
          const blob = await imageResponse.blob();
          const extension = (blob.type.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '');
          files = [new File([blob], `mix-gold-${slug}.${extension}`, { type: blob.type || 'image/jpeg' })];
        }
      }

      if (navigator.share) {
        const shareData = { title, text: shareText };
        if (files.length && navigator.canShare?.({ files })) shareData.files = files;
        await navigator.share(shareData);
        setShareState('تم فتح قائمة المشاركة؛ اختر Facebook.');
        return;
      }

      await navigator.clipboard.writeText(shareText);
      setShareState('تم نسخ نص المنشور. الصقه في Facebook.');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(shareText);
        setShareState('تعذر إرفاق الصورة تلقائيًا؛ تم نسخ النص للصقه في Facebook.');
      } catch {
        setShareState('انسخ النص يدويًا ثم الصقه في Facebook.');
      }
    }
  }

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
          <button
            type="button"
            onClick={sharePost}
            style={styles.primaryBtn}
            aria-label="مشاركة نص المنشور وصورته"
          >
            مشاركة المنشور
          </button>
          {shareState ? <div style={styles.shareState} role="status">{shareState}</div> : null}
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
    border: 0,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 15,
  },
  shareState: { width: '100%', color: '#c9c9c9', fontSize: 13, lineHeight: 1.6 },
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
