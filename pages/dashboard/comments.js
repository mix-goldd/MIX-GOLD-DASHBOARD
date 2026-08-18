import { useState } from 'react';
import Layout from '../../components/Layout';
import { getSessionFromReq } from '../../lib/auth';
import { listComments } from '../../lib/siteDb';

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export async function getServerSideProps({ req }) {
  const session = getSessionFromReq(req);
  if (!session) {
    return { redirect: { destination: '/login', permanent: false } };
  }

  let comments = [];
  try {
    comments = await listComments(200);
  } catch (err) {
    console.error('تعذر جلب التعليقات:', err.message);
  }

  return { props: { session, comments } };
}

export default function Comments({ session, comments: initialComments }) {
  const [comments, setComments] = useState(initialComments);
  const [query, setQuery] = useState('');
  const [error, setError] = useState(null);

  const filtered = query.trim()
    ? comments.filter((c) => {
        const q = query.trim().toLowerCase();
        return (
          (c.content || '').toLowerCase().includes(q) ||
          (c.post?.title || '').toLowerCase().includes(q) ||
          (c.profiles?.username || '').toLowerCase().includes(q)
        );
      })
    : comments;

  async function handleDelete(id) {
    if (!confirm('حذف هذا التعليق نهائيًا من الموقع؟')) return;
    const prev = comments;
    setComments(comments.filter((c) => c.id !== id));
    try {
      const res = await fetch(`/api/comments?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('فشل حذف التعليق.');
    } catch (err) {
      setComments(prev);
      setError(err.message);
    }
  }

  return (
    <Layout title="التعليقات" session={session}>
      <div dir="rtl" className="am-panel">
        <h2 className="am-section-title" style={{ margin: '0 0 8px' }}>
          التعليقات ({comments.length})
        </h2>
        <p className="helper-text">كل التعليقات المكتوبة على الموقع، الأحدث أولًا.</p>

        {error ? <div className="banner banner-error">{error}</div> : null}

        <div className="field" style={{ maxWidth: 320 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث في التعليقات، العناوين، أو أسماء المستخدمين..."
          />
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">
            <span className="tally-dot" />
            <p>{comments.length === 0 ? 'لا توجد تعليقات بعد.' : 'لا توجد نتائج مطابقة.'}</p>
          </div>
        ) : (
          <div className="comment-list">
            {filtered.map((c) => (
              <div className="comment-row" key={c.id}>
                {c.post?.thumbnail_url ? (
                  <img src={c.post.thumbnail_url} alt="" className="comment-post-thumb" />
                ) : (
                  <div className="comment-post-thumb comment-post-thumb-empty">
                    <i className="fas fa-film" />
                  </div>
                )}
                <div className="comment-body">
                  <div className="comment-meta">
                    {c.profiles?.avatar_url ? (
                      <img src={c.profiles.avatar_url} alt="" className="comment-avatar" />
                    ) : (
                      <div className="comment-avatar comment-avatar-empty">
                        <i className="fas fa-user" />
                      </div>
                    )}
                    <strong>{c.profiles?.username || 'مستخدم'}</strong>
                    <span className="comment-on">على</span>
                    <span className="comment-post-title">{c.post?.title || c.post_id}</span>
                    {c.parent_comment_id ? <span className="comment-reply-tag">رد</span> : null}
                  </div>
                  <div className="comment-content">{c.content}</div>
                  <div className="comment-time">{formatDate(c.created_at)}</div>
                </div>
                <button className="comment-delete" title="حذف" onClick={() => handleDelete(c.id)}>
                  <i className="fas fa-trash" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
