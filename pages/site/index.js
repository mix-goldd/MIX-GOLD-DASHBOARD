import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { listPosts } from '../../lib/siteDb';
import { slugFromKey } from '../../lib/slug';
import { getDashboardSetting } from '../../lib/db';
import { findVidmolyLibraryMatch } from '../../lib/vidmolyLibraryMatch';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function requestSiteUrl(req) {
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  const protocol = req?.headers?.['x-forwarded-proto'] || 'https';
  return host ? `${protocol}://${host}`.replace(/\/+$/, '') : 'https://mix-goldd.vercel.app';
}

export async function getServerSideProps({ req, res }) {
  const source = path.join(process.cwd(), 'dist', 'public', 'site', 'index.html');
  let html = await readFile(source, 'utf8');
  const pathname = String(req?.url || '').split('?')[0];
  const match = pathname.match(/^\/post\/([^/]+)\/?$/);

  if (match) {
    const slug = decodeURIComponent(match[1]);
    try {
      const posts = await listPosts();
      const post = posts.find((item) => slugFromKey(item.thumbnail_url) === slug);
      if (post) {
        const snapshot = await getDashboardSetting('vidmoly_library_snapshot_v1');
        const vidmolyMatch = findVidmolyLibraryMatch(post.title, snapshot?.payload || null);
        const title = post.title || 'MIX GOLD';
        const description = post.description || post.synopsis || '';
        const image = vidmolyMatch?.thumbnail_url || post.thumbnail_url || '';
        const publicPostUrl = `${requestSiteUrl(req)}/post/${slug}`;
        const shareDescription = [description, publicPostUrl].filter(Boolean).join('\n\n');
        const tags = [
          `<title>${escapeHtml(title)} | MIX GOLD</title>`,
          `<meta name="description" content="${escapeHtml(description)}">`,
          '<meta property="og:type" content="article">',
          `<meta property="og:title" content="${escapeHtml(title)}">`,
          `<meta property="og:description" content="${escapeHtml(shareDescription)}">`,
          `<meta property="og:image" content="${escapeHtml(image)}">`,
          `<meta property="og:url" content="${escapeHtml(publicPostUrl)}">`,
          '<meta name="twitter:card" content="summary_large_image">',
          `<meta name="twitter:title" content="${escapeHtml(title)}">`,
          `<meta name="twitter:description" content="${escapeHtml(shareDescription)}">`,
          `<meta name="twitter:image" content="${escapeHtml(image)}">`,
          `<link rel="canonical" href="${escapeHtml(publicPostUrl)}">`,
        ].join('\n    ');
        html = html.replace(/<title>[\s\S]*?<\/title>/i, '').replace('</head>', `    ${tags}\n  </head>`);
      }
    } catch (error) {
      console.error('تعذر تجهيز معاينة المنشور العامة:', error.message);
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
  res.write(html);
  res.end();
  return { props: {} };
}

export default function SePlatformDocument() {
  return null;
}
