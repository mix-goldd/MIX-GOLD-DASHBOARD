import { readFile } from 'node:fs/promises';
import path from 'node:path';

// The imported S-E page remains a standalone HTML document so its original
// design and client behavior are preserved. The deployment package keeps it
// under dist/public, while this route makes it available through Next as well.
export async function getServerSideProps({ res }) {
  const source = path.join(process.cwd(), 'dist', 'public', 'site', 'index.html');
  const html = await readFile(source, 'utf8');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.write(html);
  res.end();
  return { props: {} };
}

export default function SePlatformDocument() {
  return null;
}
