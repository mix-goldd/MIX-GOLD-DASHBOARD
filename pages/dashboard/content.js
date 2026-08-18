import { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../../components/Layout';
import Dropdown from '../../components/Dropdown';
import { getSessionFromReq } from '../../lib/auth';
import { getSetting, listPosts, listModels, listMediaItems } from '../../lib/siteDb';
import { findMediaLibraryMatch } from '../../lib/mediaLibraryMatch';
import { POST_TYPES, formatDuration, normalizeCategories, normalizeContentTypes } from '../../lib/animeContent';
import { slugFromKey } from '../../lib/slug';

const DEFAULT_CATEGORIES = ['Shonen', 'Seinen', 'Shojo', 'Isekai', 'Mecha', 'Slice of Life'];
const EMPTY_FORM = {
  type: 'video',
  categories: [],
  title: '',
  image: '',
  url: '',
  download_url: '',
  studio: '',
  series: '',
  duration: '',
  description: '',
  model_id: '',
};

// Publish date should read in plain English digits/months, not the
// Arabic-Indic numerals ar-EG gives (e.g. "٢٠٢٦/٧/٢٨").
function formatPublishDate(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export async function getServerSideProps({ req }) {
  const session = getSessionFromReq(req);
  if (!session) {
    return { redirect: { destination: '/login', permanent: false } };
  }

  let posts = [];
  let models = [];
  let mediaItems = [];
  let categories = DEFAULT_CATEGORIES;
  let contentTypes = POST_TYPES;

  try {
    let rawCategories;
    [posts, models, mediaItems, rawCategories, contentTypes] = await Promise.all([
      listPosts(),
      listModels(),
      listMediaItems(),
      getSetting('video_categories', DEFAULT_CATEGORIES),
      getSetting('content_types', POST_TYPES),
    ]);
    categories = normalizeCategories(rawCategories)
      .filter((c) => c.enabled)
      .map((c) => c.name);
    if (!categories.length) categories = DEFAULT_CATEGORIES;
  } catch (err) {
    console.error('تعذر جلب المحتوى من قاعدة بيانات الموقع:', err.message);
  }

  return {
    props: {
      session,
      posts,
      models,
      mediaItems,
      categories,
      contentTypes: normalizeContentTypes(contentTypes),
    },
  };
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'فشل النشر على الموقع');
  return data;
}

function normalizeText(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function collectArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(collectArray);
  if (typeof value !== 'object') return [];

  if (Array.isArray(value.result)) return value.result.flatMap(collectArray);
  if (Array.isArray(value.files)) return value.files.flatMap(collectArray);
  if (Array.isArray(value.items)) return value.items.flatMap(collectArray);
  if (Array.isArray(value.data)) return value.data.flatMap(collectArray);

  if (value.file_code || value.filecode || value.code || value.title || value.name) return [value];
  if (value.result) return collectArray(value.result);
  if (value.data) return collectArray(value.data);
  return [];
}

function buildPlaybackUrl(item) {
  const direct = item.playback_url || item.play_url || item.embed_url || item.video_url || item.url;
  if (direct && /dood|vidmoly/i.test(direct)) return direct;
  const fileCode = item.file_code || item.filecode || item.code || item.fileCode || item.id;
  // Vidmoly's active public player uses the .biz embed host. The legacy .to
  // host must not be emitted because it can redirect away from the video.
  if (fileCode) return `https://vidmoly.biz/embed-${fileCode}.html`;
  return direct || '';
}

function scoreMatch(query, item) {
  const queryNorm = normalizeText(query);
  const titleNorm = normalizeText(item.title || item.name || item.file_title || item.file_name || '');
  if (!queryNorm || !titleNorm) return 0;

  let score = 0;
  if (titleNorm === queryNorm) score += 100;
  if (titleNorm.includes(queryNorm)) score += 60;
  if (queryNorm.includes(titleNorm)) score += 35;

  const queryTokens = new Set(queryNorm.split(' ').filter(Boolean));
  const titleTokens = titleNorm.split(' ').filter(Boolean);
  let overlap = 0;
  titleTokens.forEach((token) => {
    if (queryTokens.has(token)) overlap += 1;
  });
  score += overlap * 8;

  if (item.length || item.duration) score += 2;
  if (item.file_code || item.filecode || item.code) score += 2;
  if (item.download_url || item.playback_url) score += 1;
  return score;
}

function chooseBestMatch(query, rawPayload) {
  const items = collectArray(rawPayload);
  if (!items.length) return null;

  const ranked = items
    .map((item) => ({ item, score: scoreMatch(query, item) }))
    .sort((a, b) => b.score - a.score);

  if (!ranked.length || ranked[0].score <= 0) return null;
  return ranked[0].item;
}

export default function AnimeContent({
  session,
  posts: initialPosts,
  models: initialModels,
  categories: initialCategories,
  contentTypes,
  mediaItems: initialMediaItems,
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [models, setModels] = useState(initialModels);
  const [mediaItems] = useState(Array.isArray(initialMediaItems) ? initialMediaItems : []);
  const [categories] = useState(initialCategories);
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingKind, setEditingKind] = useState(null); // 'post' | 'model' | null
  const [form, setForm] = useState({
    ...EMPTY_FORM,
    categories: initialCategories[0] ? [initialCategories[0]] : [],
  });
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [lookupState, setLookupState] = useState({ status: 'idle', message: '', result: null });
  const lookupRequestId = useRef(0);
  const suppressLookupRef = useRef(false);
  const autoMatchedImageRef = useRef('');
  // Vidmoly returns the download URL independently from the playback/embed URL.
  // Never derive the download field from the playback field.
  const downloadUrlManualRef = useRef(false);
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);

  // "شخصية أنمي" (model) entries live in their own `models` table — the
  // site's Models section only ever reads from there, not from `posts` —
  // so the two are merged here just for one combined "كل المحتويات" list.
  const allItems = useMemo(() => {
    const modelItems = models.map((m) => ({
      id: m.id,
      _kind: 'model',
      type: 'model',
      title: m.name,
      thumbnail_url: m.thumbnail_url,
      created_at: m.created_at,
      duration: null,
      description: null,
    }));
    const postItems = posts.map((p) => ({ ...p, _kind: 'post' }));
    return [...postItems, ...modelItems].sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
    );
  }, [posts, models]);

  const studioOptions = useMemo(() => {
    const values = new Set();
    posts.forEach((post) => {
      const label = (post.studio || '').trim();
      if (label) values.add(label);
    });
    return [...values].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [posts]);

  const seriesOptions = useMemo(() => {
    const values = new Set();
    posts.forEach((post) => {
      const label = (post.series || '').trim();
      if (label) values.add(label);
    });
    return [...values].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [posts]);

  const modelOptions = useMemo(
    () =>
      models
        .map((m) => ({ id: m.id, label: (m.name || '').trim() }))
        .filter((model) => model.label)
        .sort((a, b) => a.label.localeCompare(b.label, 'ar')),
    [models]
  );

  async function runDoodLookup(rawTitle, { silent = false } = {}) {
    const title = (rawTitle || '').trim();
    if (form.type !== 'video' || title.length < 3) {
      setLookupState({ status: 'idle', message: '', result: null });
      return null;
    }

    const requestId = ++lookupRequestId.current;
    if (!silent) {
      setLookupState({ status: 'loading', message: 'جارٍ المطابقة مع مكتبة Vidmoly المحفوظة…', result: null });
    }

    try {
      const res = await fetch(`/api/doodstream/lookup?title=${encodeURIComponent(title)}`);
      const data = await res.json().catch(() => ({}));
      if (requestId !== lookupRequestId.current) return null;

      if (!res.ok) {
        const message = data.error || data.msg || 'تعذر العثور على نتيجة مناسبة.';
        setLookupState({ status: 'error', message, result: null });
        return null;
      }

      const result = data.result || data;
      const playbackUrl = result.playback_url || result.playbackUrl || result.embed_url || '';
      const downloadUrl = result.download_url || result.downloadUrl || '';
      const duration = formatDuration(result.duration || '');
      const thumbnail = result.thumbnail_url || result.thumb || result.single_img || '';
      const matchedTitle = result.title || result.name || title;
      const fileCode = result.file_code || result.fileCode || '';

      setForm((current) => ({
        ...current,
        title: matchedTitle || current.title,
        url: playbackUrl || current.url,
        download_url:
          !downloadUrlManualRef.current && downloadUrl
            ? downloadUrl
            : current.download_url,
        duration: duration || current.duration,
        image: current.image || thumbnail,
      }));

      const message = playbackUrl
        ? `تمت المطابقة مع: ${matchedTitle}${fileCode ? ` · ${fileCode}` : ''}${duration ? ` — المدة ${duration}` : ''}`
        : `تم العثور على نتيجة قريبة: ${matchedTitle}`;

      setLookupState({
        status: 'success',
        message,
        result: {
          title: matchedTitle,
          playbackUrl,
          downloadUrl,
          duration,
          thumbnail,
          fileCode,
        },
      });
      return result;
    } catch (err) {
      if (requestId !== lookupRequestId.current) return null;
      setLookupState({ status: 'error', message: 'تعذر قراءة مكتبة Vidmoly المحفوظة الآن.', result: null });
      return null;
    }
  }

  useEffect(() => {
    if (!showEditor) return undefined;

    const title = form.title.trim();
    const match = title.length >= 2 ? findMediaLibraryMatch(title, mediaItems) : null;
    const matchedImage = match && match.image_url ? match.image_url : '';

    setForm((current) => {
      if (matchedImage) {
        if (!current.image || current.image === autoMatchedImageRef.current) {
          autoMatchedImageRef.current = matchedImage;
          return { ...current, image: matchedImage };
        }
        return current;
      }

      if (autoMatchedImageRef.current && current.image === autoMatchedImageRef.current) {
        autoMatchedImageRef.current = '';
        return { ...current, image: '' };
      }
      return current;
    });
    return undefined;
  }, [form.title, mediaItems, showEditor]);

  useEffect(() => {
    if (!showEditor || form.type !== 'video') {
      setLookupState({ status: 'idle', message: '', result: null });
      return undefined;
    }

    if (suppressLookupRef.current) {
      suppressLookupRef.current = false;
      return undefined;
    }

    const title = form.title.trim();
    if (title.length < 3) {
      setLookupState({ status: 'idle', message: '', result: null });
      return undefined;
    }

    const timer = setTimeout(() => {
      runDoodLookup(title, { silent: false });
    }, 650);

    return () => clearTimeout(timer);
  }, [form.title, form.type, showEditor]);

  function addCategory(raw) {
    const value = (raw || '').trim();
    if (!value) return;
    setForm((current) =>
      current.categories.includes(value) ? current : { ...current, categories: [...current.categories, value] }
    );
    setNewCategoryInput('');
  }

  function removeCategory(value) {
    setForm((current) => ({ ...current, categories: current.categories.filter((c) => c !== value) }));
  }

  function openEditor() {
    setEditingId(null);
    setEditingKind(null);
    setForm({
      ...EMPTY_FORM,
      categories: categories[0] ? [categories[0]] : [],
    });
    setNewCategoryInput('');
    setStatus(null);
    setUploadError(null);
    setLookupState({ status: 'idle', message: '', result: null });
    autoMatchedImageRef.current = '';
    downloadUrlManualRef.current = false;
    setShowEditor(true);
  }

  function openEditorForItem(item) {
    suppressLookupRef.current = true;
    const existingCategories = Array.isArray(item.categories) && item.categories.length
      ? item.categories
      : item.category
      ? [item.category]
      : categories[0]
      ? [categories[0]]
      : [];
    setEditingId(item.id);
    setEditingKind(item._kind);
    setForm({
      type: item.type || 'video',
      categories: existingCategories,
      title: item.title || '',
      image: item.thumbnail_url || '',
      url: item.page_url || '',
      download_url: item.download_url || '',
      studio: item.studio || '',
      series: item.series || '',
      duration: item.duration || '',
      description: item.description || '',
      model_id: item.model_id || '',
    });
    setStatus(null);
    setUploadError(null);
    setLookupState({ status: 'idle', message: '', result: null });
    autoMatchedImageRef.current = '';
    // A download link is independent metadata returned by Vidmoly.
    // Never infer it from the playback/embed URL.
    downloadUrlManualRef.current = Boolean(item.download_url);
    setShowEditor(true);
  }

  function closeEditor() {
    setShowEditor(false);
    setEditingId(null);
    setEditingKind(null);
    setUploadError(null);
    setNewCategoryInput('');
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const resolvedTitle = form.title.trim();
    const resolvedImage = form.image.trim();
    const resolvedUrl = form.url.trim();

    if (!resolvedTitle || !resolvedImage) {
      setStatus({ type: 'error', message: 'العنوان وصورة الغلاف مطلوبان.' });
      return;
    }

    const isModel = form.type === 'model';

    // "شخصية أنمي" entries only ever get a name + cover photo — they publish
    // to the `models` table (what the site's Models section actually reads),
    // not `posts`.
    if (isModel) {
      setSaving(true);
      try {
        const payload = { name: resolvedTitle, thumbnail_url: resolvedImage };
        if (editingId && editingKind === 'model') {
          const res = await fetch(`/api/content/models/${editingId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'فشل حفظ التعديلات');

          setModels((current) => current.map((m) => (m.id === editingId ? data.model : m)));
          setStatus({ type: 'success', message: `تم حفظ التعديلات على "${data.model.name}".` });
        } else {
          const { model: created } = await postJSON('/api/content/models', payload);
          setModels((current) => [created, ...current]);
          setStatus({ type: 'success', message: `تم نشر "${created.name}" على الموقع مباشرة.` });
        }
        closeEditor();
      } catch (err) {
        setStatus({ type: 'error', message: err.message });
      } finally {
        setSaving(false);
      }
      return;
    }

    const lookupResult = lookupState.result || null;
    const payloadUrl = resolvedUrl || lookupResult?.playbackUrl || lookupResult?.playback_url || '';

    if (form.type === 'video' && !payloadUrl) {
      setStatus({ type: 'error', message: 'رابط التشغيل مطلوب لمنشور الحلقة، جرّب البحث التلقائي أو أدخله يدويًا.' });
      return;
    }

    const resolvedDownloadUrl = form.download_url.trim() || lookupResult?.downloadUrl || '';

    const payload = {
      type: form.type,
      title: resolvedTitle,
      thumbnail_url: resolvedImage,
      page_url: payloadUrl || null,
      download_url: resolvedDownloadUrl || null,
      categories: form.type === 'video' ? form.categories : undefined,
      studio: form.studio || undefined,
      series: form.series || undefined,
      duration: form.duration || lookupResult?.duration || undefined,
      description: form.description.trim() || undefined,
      synopsis: form.description.trim() || undefined,
      model_id: form.model_id || undefined,
    };

    setSaving(true);
    try {
      if (editingId && editingKind === 'post') {
        const res = await fetch(`/api/content/posts/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'فشل حفظ التعديلات');

        setPosts((current) => current.map((p) => (p.id === editingId ? data.post : p)));
        setStatus({ type: 'success', message: `تم حفظ التعديلات على "${data.post.title}".` });
      } else {
        const { post: created } = await postJSON('/api/content/posts', payload);
        setPosts((current) => [created, ...current]);
        setStatus({ type: 'success', message: `تم نشر "${created.title}" على الموقع مباشرة.` });
      }
      closeEditor();
    } catch (err) {
      setStatus({ type: 'error', message: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item) {
    if (!confirm('حذف هذا المحتوى من الموقع؟')) return;

    if (item._kind === 'model') {
      const prev = models;
      setModels(models.filter((m) => m.id !== item.id));
      try {
        const res = await fetch(`/api/content/models/${item.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'فشل الحذف');
        }
      } catch (err) {
        setModels(prev);
        alert(`تعذر الحذف من الموقع: ${err.message}`);
      }
      return;
    }

    const prev = posts;
    setPosts(posts.filter((p) => p.id !== item.id));
    try {
      const res = await fetch(`/api/content/posts/${item.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'فشل الحذف');
      }
    } catch (err) {
      setPosts(prev);
      alert(`تعذر الحذف من الموقع: ${err.message}`);
    }
  }

  // ---- imgbb upload (cover image field) ----
  async function handleImageFileChange(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;

    setUploadError(null);
    setUploading(true);
    try {
      const body = new FormData();
      body.append('image', file);
      body.append('name', form.title.trim() || file.name);
      const res = await fetch('/api/media/upload', { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'فشل رفع الصورة إلى imgbb.');
      autoMatchedImageRef.current = '';
      setForm((current) => ({ ...current, image: data.item.url }));
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleAiGenerate() {
    if (!form.image) {
      setAiError('لازم تضيف صورة الغلاف الأول عشان الذكاء الاصطناعي يقدر يحلل المحتوى.');
      return;
    }
    setAiError(null);
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai/generate-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: form.image, existing_title: form.title.trim(), type: form.type }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // `raw` is only present when Gemini's response genuinely didn't
        // parse as expected — same screenshot-and-fix pattern used for
        // the Vidmoly migration's field-name mismatches.
        throw new Error(data.raw ? `${data.error}\n${data.raw}` : data.error || 'تعذر توليد العنوان والوصف.');
      }
      setForm((current) => ({
        ...current,
        title: data.title || current.title,
        description: data.description || current.description,
      }));
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <Layout title="إضافة محتوى" session={session}>
      <div dir="rtl" className="am-panel">
        {!showEditor && (
          <>
            <div className="am-row-between">
              <h2 className="am-section-title">جميع المحتويات</h2>
            </div>

            {status && (
              <div className={`banner ${status.type === 'error' ? 'banner-error' : 'banner-success'}`}>
                {status.message}
              </div>
            )}

            {allItems.length === 0 ? (
              <div className="empty-state">
                <span className="tally-dot" />
                <p>لا يوجد محتوى بعد — أضف أول عنصر وسينشر مباشرة على موقع S-E.</p>
              </div>
            ) : (
              <div className="am-posts-list">
                {allItems.map((item) => (
                  <div
                    className="am-post-card am-post-card-clickable"
                    key={`${item._kind}-${item.id}`}
                    onClick={() => openEditorForItem(item)}
                    title="اضغط للتعديل"
                  >
                    <img src={item.thumbnail_url} className="am-post-img" alt={item.title} />
                    <div className="am-post-info">
                      <div className="am-post-title">{item.title}</div>
                      <div className="am-post-meta" style={{ flexWrap: 'wrap' }}>
                        <span>
                          <i className="fas fa-play-circle" /> {contentTypes.find((t) => t.value === item.type)?.label || item.type}
                        </span>
                        <span>
                          <i className="far fa-calendar-alt" /> {formatPublishDate(item.created_at) || 'غير معروف'}
                        </span>
                        {item.duration ? (
                          <span>
                            <i className="fas fa-clock" /> {formatDuration(item.duration)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <button
                      className="am-icon-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item);
                      }}
                      title="حذف"
                    >
                      <i className="fas fa-trash" />
                    </button>
                    {item._kind === 'post' && item.thumbnail_url ? (
                      <button
                        className="am-icon-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(`/watch/${slugFromKey(item.thumbnail_url)}`, '_blank');
                        }}
                        title="فتح الصفحة الفرعية (رابط حقيقي للمشاركة)"
                      >
                        <i className="fas fa-link" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <button className="am-fab" onClick={openEditor} aria-label="إضافة محتوى" title="إضافة محتوى">
              <i className="fas fa-plus" />
            </button>
          </>
        )}

        {showEditor && (
          <div className="card am-editor-card">
            <div className="am-row-between">
              <h2 style={{ margin: 0 }}>
                <i className={editingId ? 'fas fa-pencil-alt' : 'fas fa-plus-circle'} />{' '}
                {editingId ? 'تعديل المحتوى' : 'إضافة محتوى أنمي جديد'}
              </h2>
              <button className="am-icon-btn" onClick={closeEditor} title="إغلاق">
                <i className="fas fa-times" />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="am-dropdown-row">
                <div className="field">
                  <label>نوع المحتوى</label>
                  <Dropdown
                    value={form.type}
                    onChange={(v) => setForm({ ...form, type: v })}
                    options={contentTypes}
                    disabled={!!editingId}
                  />
                </div>

              </div>

              {form.type === 'video' && (
                <div className="field">
                  <label>التصنيفات (Categories)</label>
                  {form.categories.length ? (
                    <div className="am-category-chips">
                      {form.categories.map((c) => (
                        <span className="am-category-chip" key={c}>
                          {c}
                          <button type="button" onClick={() => removeCategory(c)} title="إزالة">
                            &times;
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="am-category-empty">لم تتم إضافة أي تصنيف بعد.</div>
                  )}
                  <div className="am-category-add-row">
                    <Dropdown
                      value=""
                      onChange={(v) => {
                        if (v) addCategory(v);
                      }}
                      placeholder="+ اختر من القائمة"
                      options={categories.filter((c) => !form.categories.includes(c))}
                    />
                    <input
                      type="text"
                      value={newCategoryInput}
                      onChange={(e) => setNewCategoryInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addCategory(newCategoryInput);
                        }
                      }}
                      placeholder="أضف تصنيفًا جديدًا..."
                    />
                    <button type="button" className="btn" onClick={() => addCategory(newCategoryInput)}>
                      <i className="fas fa-plus" /> إضافة
                    </button>
                  </div>
                </div>
              )}

              <div className="field">
                <label>العنوان / الاسم</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="مثال: هجوم العمالقة - الحلقة الأولى"
                />
              </div>

              <div className="field">
                <label>صورة الغلاف</label>
                {form.image ? (
                  <img src={form.image} alt="معاينة" className="am-image-preview" />
                ) : null}
                <input
                  value={form.image}
                  onChange={(e) => {
                    autoMatchedImageRef.current = '';
                    setForm({ ...form, image: e.target.value });
                  }}
                  placeholder="مثال: https://iili.io/image.jpg"
                />
                <div className="am-image-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => fileInputRef.current && fileInputRef.current.click()}
                    disabled={uploading}
                  >
                    <i className="fas fa-upload" /> {uploading ? 'جارٍ الرفع...' : 'ارفع من الجهاز'}
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleImageFileChange}
                />
                {uploadError ? <div className="banner banner-error">{uploadError}</div> : null}
              </div>

              <div className="field">
                <button type="button" className="btn btn-ai" onClick={handleAiGenerate} disabled={aiLoading || !form.image}>
                  <i className="fas fa-wand-magic-sparkles" />{' '}
                  {aiLoading ? 'جارٍ التوليد بالذكاء الاصطناعي...' : 'اقترح عنوان ووصف بالذكاء الاصطناعي'}
                </button>
                {!form.image && <div className="field-hint">محتاج صورة الغلاف الأول.</div>}
                {aiError ? <div className="banner banner-error">{aiError}</div> : null}
              </div>

              {form.type !== 'model' && (
                <div className="field">
                  <label>ملخص القصة / الوصف</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="اكتب ملخصًا قصيرًا للقصة أو وصفًا واضحًا للمحتوى..."
                    rows={5}
                  />
                </div>
              )}

              {form.type !== 'model' && (
                <div className="field">
                  <label>رابط التشغيل (Vidmoly)</label>
                  <input
                    value={form.url}
                    onChange={(e) => {
                      const nextUrl = e.target.value;
                      setForm((current) => ({
                        ...current,
                        url: nextUrl,
                        download_url: current.download_url,
                      }));
                    }}
                    placeholder="مثال: https://vidmoly.to/embed-xxxxx.html"
                  />
                </div>
              )}

              {form.type !== 'model' && (
                <div className="field">
                  <label>رابط تحميل (Vidmoly)</label>
                  <input
                    value={form.download_url}
                    onChange={(e) => {
                      downloadUrlManualRef.current = true;
                      setForm({ ...form, download_url: e.target.value });
                    }}
                    placeholder="يُملأ تلقائيًا من Vidmoly: https://vidmoly.to/d/xxxxx"
                  />
                </div>
              )}

              {form.type === 'video' && (
                <>
                  <div className="am-dropdown-row">
                    <div className="field">
                      <label>الموديل</label>
                      <Dropdown
                        value={form.model_id}
                        onChange={(v) => setForm({ ...form, model_id: v })}
                        options={[
                          { value: '', label: 'بدون موديل' },
                          ...modelOptions.map((model) => ({ value: model.id, label: model.label })),
                        ]}
                      />
                    </div>

                    <div className="field">
                      <label>الاستوديو</label>
                      <Dropdown
                        value={form.studio}
                        onChange={(v) => setForm({ ...form, studio: v })}
                        options={[{ value: '', label: 'اختر من القائمة' }, ...studioOptions]}
                      />
                    </div>
                  </div>

                  <div className="am-dropdown-row">
                    <div className="field">
                      <label>السلسلة</label>
                      <Dropdown
                        value={form.series}
                        onChange={(v) => setForm({ ...form, series: v })}
                        options={[{ value: '', label: 'اختر من القائمة' }, ...seriesOptions]}
                      />
                    </div>

                    <div className="field">
                      <label>المدة</label>
                      <input
                        value={form.duration}
                        onChange={(e) => setForm({ ...form, duration: e.target.value })}
                        placeholder="مثال: 24:00"
                      />
                    </div>
                  </div>
                </>
              )}

              {status && status.type === 'error' && <div className="banner banner-error">{status.message}</div>}

              <button type="submit" className="btn btn-primary btn-full" disabled={saving}>
                <i className="fas fa-paper-plane" />{' '}
                {saving ? (editingId ? 'جارٍ الحفظ...' : 'جارٍ النشر...') : editingId ? 'حفظ التعديلات' : 'نشر على الموقع'}
              </button>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}
