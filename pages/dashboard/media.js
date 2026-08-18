import { useRef, useState } from 'react';
import Layout from '../../components/Layout';
import { getSessionFromReq } from '../../lib/auth';
import { listMediaItems } from '../../lib/siteDb';

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export async function getServerSideProps({ req }) {
  const session = getSessionFromReq(req);
  if (!session) {
    return { redirect: { destination: '/login', permanent: false } };
  }

  let items = [];
  try {
    items = await listMediaItems();
  } catch (err) {
    console.error('تعذر جلب مكتبة الوسائط:', err.message);
  }

  return { props: { session, items } };
}

export default function MediaLibrary({ session, items: initialItems }) {
  const [items, setItems] = useState(initialItems);
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [editingNameId, setEditingNameId] = useState(null);
  const [nameDraft, setNameDraft] = useState('');
  const fileInputRef = useRef(null);

  const filtered = query.trim()
    ? items.filter((item) => (item.name || '').toLowerCase().includes(query.trim().toLowerCase()))
    : items;

  async function handleFileChange(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;

    setError(null);
    setUploading(true);
    try {
      const body = new FormData();
      body.append('image', file);
      body.append('name', file.name);
      const res = await fetch('/api/media/upload', { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'فشل رفع الصورة إلى imgbb.');
      setItems((current) => [data.item, ...current]);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('حذف هذه الصورة من المكتبة؟')) return;
    const prev = items;
    setItems(items.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/media/library?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('فشل الحذف');
    } catch (err) {
      setItems(prev);
      alert(err.message);
    }
  }

  async function handleCopy(item) {
    try {
      await navigator.clipboard.writeText(item.url);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((current) => (current === item.id ? null : current)), 1500);
    } catch (err) {
      // Clipboard API can fail without HTTPS/permissions — not critical.
    }
  }

  function startRename(item) {
    setEditingNameId(item.id);
    setNameDraft(item.name || '');
  }

  function cancelRename() {
    setEditingNameId(null);
    setNameDraft('');
  }

  async function saveRename(id) {
    const name = nameDraft.trim();
    if (!name) return cancelRename();
    const prev = items;
    setItems(items.map((i) => (i.id === id ? { ...i, name } : i)));
    setEditingNameId(null);
    try {
      const res = await fetch('/api/media/library', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name }),
      });
      if (!res.ok) throw new Error('فشل تحديث الاسم');
    } catch (err) {
      setItems(prev);
      alert(err.message);
    }
  }

  return (
    <Layout title="مكتبة الوسائط" session={session}>
      <div dir="rtl" className="am-panel">
        <div className="am-media-page-header">
          <h2 className="am-section-title" style={{ margin: 0 }}>
            مكتبة الوسائط
          </h2>
          <button className="btn btn-primary" onClick={() => fileInputRef.current && fileInputRef.current.click()} disabled={uploading}>
            <i className="fas fa-upload" /> {uploading ? 'جارٍ الرفع...' : 'ارفع صورة جديدة'}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
        </div>

        <p className="helper-text">
          كل الصور التي رفعتها من هنا أو من صفحة "إضافة محتوى" مرفوعة على imgbb، والرابط جاهز للاستخدام في أي مكان. imgbb
          نفسه لا يدعم مجلدات حقيقية، فهذه قائمة واحدة يمكنك البحث فيها بالاسم.
        </p>

        {error ? <div className="banner banner-error">{error}</div> : null}

        <div className="field" style={{ maxWidth: 320 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث بالاسم..."
          />
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">
            <span className="tally-dot" />
            <p>{items.length === 0 ? 'لا توجد صور مرفوعة بعد.' : 'لا توجد نتائج مطابقة.'}</p>
          </div>
        ) : (
          <div className="am-media-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
            {filtered.map((item) => (
              <div className="am-media-card" key={item.id}>
                <div className="am-media-item" style={{ border: 'none', borderRadius: 0 }}>
                  <img src={item.thumb || item.url} alt={item.name} />
                  <button className="am-media-item-delete" title="حذف" onClick={() => handleDelete(item.id)}>
                    <i className="fas fa-trash" />
                  </button>
                </div>
                <div className="am-media-card-body">
                  {editingNameId === item.id ? (
                    <input
                      className="am-media-card-name-input"
                      autoFocus
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onBlur={() => saveRename(item.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); saveRename(item.id); }
                        if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                      }}
                    />
                  ) : (
                    <div
                      className="am-media-card-name am-media-card-name-editable"
                      title="اضغط لتعديل الاسم"
                      onClick={() => startRename(item)}
                    >
                      {item.name || 'بدون اسم'} <i className="fas fa-pencil-alt" />
                    </div>
                  )}
                  <div className="am-media-card-date">{formatDate(item.uploaded_at)}</div>
                  <button className="am-media-copy-link" onClick={() => handleCopy(item)}>
                    <i className="fas fa-link" /> {copiedId === item.id ? 'تم النسخ' : 'نسخ الرابط'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
