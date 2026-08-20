const ALLOWED_HOSTS = new Set([
  'veros-1479-p2.vmwesa.online',
  'vidmoly.biz',
  'vidmoly.me',
]);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const target = new URL(String(req.query.url || ''));
    if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
      return res.status(400).json({ error: 'Unsupported image host' });
    }

    const upstream = await fetch(target, { redirect: 'follow' });
    const finalUrl = new URL(upstream.url || target.href);
    if (finalUrl.protocol !== 'https:' || !ALLOWED_HOSTS.has(finalUrl.hostname)) {
      return res.status(400).json({ error: 'Unsupported image redirect' });
    }
    if (!upstream.ok) {
      return res.status(502).json({ error: 'Image source unavailable' });
    }

    const contentType = upstream.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return res.status(415).json({ error: 'Source is not an image' });
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', contentType.split(';')[0]);
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    return res.status(200).send(body);
  } catch {
    return res.status(400).json({ error: 'Invalid image URL' });
  }
}
