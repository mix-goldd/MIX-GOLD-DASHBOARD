import { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { getSessionFromReq } from '../../lib/auth';

export async function getServerSideProps({ req }) {
  const session = getSessionFromReq(req);
  if (!session) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  return { props: { session } };
}

const SIDEBAR_ITEM_HINTS = {
  videos: 'صفحة "Videos" الرئيسية',
  upload: 'صفحة "Add video"',
  content: 'صفحة "إضافة محتوى"',
  media: 'صفحة "مكتبة الوسائط"',
  statistics: 'صفحة "إحصائيات المحتوى"',
  contentManager: 'صفحة "مدير المحتوى"',
  comments: 'صفحة "التعليقات"',
  aiChat: 'صفحة «منفذ الأوامر المحلي»',
  settings: 'صفحة "الإعدادات" (اللي انت فيها دلوقتي)',
  team: 'صفحة "Team" (تظهر للأدمن بس)',
};

function nextTypeId() {
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export default function Settings({ session }) {
  const [sidebarLabels, setSidebarLabels] = useState({});
  const [contentTypes, setContentTypes] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [apiKeysError, setApiKeysError] = useState(null);
  const [vidmolyPortalSync, setVidmolyPortalSync] = useState(null);
  const [usageSyncing, setUsageSyncing] = useState(false);
  const [usageSyncMessage, setUsageSyncMessage] = useState(null);
  const [clock, setClock] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/dashboard-settings');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'تعذر تحميل الإعدادات.');
        setSidebarLabels(data.sidebarLabels);
        setContentTypes(data.contentTypes);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (session.role !== 'admin') return undefined;
    let cancelled = false;
    async function loadApiKeyStatus() {
      try {
        const res = await fetch('/api/api-keys/status');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'تعذر تحميل حالة المفاتيح.');
        if (!cancelled) {
          setApiKeys(data.keys || []);
          setVidmolyPortalSync(data.vidmolyPortalSync || null);
          setApiKeysError(null);
        }
      } catch (err) {
        if (!cancelled) setApiKeysError(err.message);
      }
    }
    loadApiKeyStatus();
    const refreshTimer = setInterval(loadApiKeyStatus, 30000);
    const clockTimer = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearInterval(refreshTimer);
      clearInterval(clockTimer);
    };
  }, [session.role]);

  function updateSidebarLabel(key, label) {
    setSidebarLabels((prev) => ({ ...prev, [key]: label }));
  }

  function updateTypeField(index, field, value) {
    setContentTypes((prev) => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)));
  }

  function removeType(index) {
    setContentTypes((prev) => prev.filter((_, i) => i !== index));
  }

  function addType() {
    setContentTypes((prev) => [...prev, { value: nextTypeId(), label: '', icon: 'fa-star' }]);
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/dashboard-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sidebarLabels, contentTypes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'تعذر الحفظ.');
      setMessage('اتحفظ. حدّث الصفحة عشان تشوف القائمة الجانبية بالتسميات الجديدة.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function formatCountdown(nextAvailableAt) {
    if (!nextAvailableAt) return '—';
    const remaining = Math.max(0, Number(nextAvailableAt) - clock);
    if (!remaining) return 'متاح الآن';
    const seconds = Math.floor(remaining / 1000);
    const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const secs = String(seconds % 60).padStart(2, '0');
    return `${hours}:${minutes}:${secs}`;
  }

  function statusLabel(key) {
    if (!key.configured) return 'غير مضاف';
    if (key.state === 'waiting') return 'بانتظار إعادة الضبط';
    return 'متاح';
  }

  async function syncVidmolyUsage() {
    setUsageSyncing(true);
    setUsageSyncMessage(null);
    try {
      const res = await fetch('/api/api-keys/sync-vidmoly-usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'تعذرت مزامنة الاستهلاك.');
      setApiKeys(data.keys || []);
      setVidmolyPortalSync(data.sync || null);
      setUsageSyncMessage('تمت مزامنة عدادات Vidmoly مباشرةً من البوابة الرسمية.');
    } catch (err) {
      setUsageSyncMessage(err.message);
    } finally {
      setUsageSyncing(false);
    }
  }

  function formatSyncTime(timestamp) {
    if (!timestamp) return 'لم تتم مزامنة ناجحة بعد';
    return new Date(Number(timestamp)).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function syncErrorText(code) {
    if (!code) return null;
    return 'تعذرت آخر مزامنة؛ ستُعاد المحاولة تلقائياً عند التشغيل التالي.';
  }

  if (loading) {
    return (
      <Layout title="الإعدادات" session={session}>
        <p className="helper-text">جارٍ التحميل...</p>
      </Layout>
    );
  }

  return (
    <Layout title="الإعدادات" session={session}>
      <div dir="rtl">
        {message ? <div className="banner banner-success">{message}</div> : null}
        {error ? <div className="banner banner-error">{error}</div> : null}

        <div className="am-panel">
          <h2 className="am-section-title">تسميات القائمة الجانبية</h2>
          <p className="helper-text">غيّر أي اسم قسم زي ما تحب — التغيير بيظهر لكل المستخدمين.</p>
          <div className="settings-field-list">
            {Object.keys(sidebarLabels).map((key) => (
              <div className="field" key={key}>
                <label>{SIDEBAR_ITEM_HINTS[key] || key}</label>
                <input value={sidebarLabels[key]} onChange={(e) => updateSidebarLabel(key, e.target.value)} />
              </div>
            ))}
          </div>
        </div>

        <div className="am-panel">
          <h2 className="am-section-title">أنواع المحتوى</h2>
          <p className="helper-text">
            تحكم كامل في القائمة اللي بتظهر عند إضافة محتوى — غيّر أي اسم، احذف نوع، أو أضف نوع جديد (زي منشورات أو مانهوا).
          </p>
          <div className="settings-type-list">
            {contentTypes.map((t, i) => (
              <div className="settings-type-row" key={t.value}>
                <input
                  className="settings-type-label"
                  value={t.label}
                  onChange={(e) => updateTypeField(i, 'label', e.target.value)}
                  placeholder="اسم النوع"
                />
                <input
                  className="settings-type-icon"
                  value={t.icon || ''}
                  onChange={(e) => updateTypeField(i, 'icon', e.target.value)}
                  placeholder="fa-icon-name"
                />
                <button type="button" className="settings-type-remove" onClick={() => removeType(i)} title="حذف النوع">
                  <i className="fas fa-trash" />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="btn" onClick={addType} style={{ marginTop: 10 }}>
            <i className="fas fa-plus" /> إضافة نوع جديد
          </button>
        </div>

        {session.role === 'admin' ? (
          <div className="am-panel api-key-panel">
            <div className="am-row-between">
              <div>
                <h2 className="am-section-title">حالة مفاتيح API والحصص</h2>
                <p className="helper-text">تظهر هنا حالة التشغيل فقط. قيم المفاتيح لا تُرسل للمتصفح ولا تظهر في هذا الجدول.</p>
              </div>
              <span className="api-key-refresh-note"><i className="fas fa-sync-alt" /> تحديث تلقائي كل 30 ثانية</span>
            </div>
            {apiKeysError ? <div className="banner banner-error">{apiKeysError}</div> : null}
            <div className="api-key-table-wrap">
              <table className="api-key-table">
                <thead>
                  <tr>
                    <th>المفتاح</th>
                    <th>الخدمة</th>
                    <th>الاستخدام اليومي</th>
                    <th>آخر دقيقة</th>
                    <th>الحالة</th>
                    <th>الانتظار</th>
                  </tr>
                </thead>
                <tbody>
                  {apiKeys.map((key) => (
                    <tr key={key.id}>
                      <td><span className="api-key-mask"><i className="fas fa-key" /> {key.label} ·••••</span></td>
                      <td>Vidmoly</td>
                      <td>{key.dailyRequests} / {key.dailyLimit}</td>
                      <td>{key.minuteLimit ? `${key.minuteRequests} / ${key.minuteLimit}` : '—'}</td>
                      <td><span className={`api-key-state api-key-state-${key.state}`}>{statusLabel(key)}</span></td>
                      <td className="api-key-countdown">{formatCountdown(key.nextAvailableAt)}</td>
                    </tr>
                  ))}
                  {!apiKeys.length && !apiKeysError ? (
                    <tr><td colSpan="6" className="api-key-empty">جارٍ تحميل حالة المفاتيح…</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="settings-vidmoly-sync">
              <h3 className="am-section-title">مزامنة تلقائية لاستهلاك Vidmoly</h3>
              <p className="helper-text">
                يقرأ النظام عداد كل حساب من بوابة Vidmoly عبر جلسة خادمية آمنة. لا تظهر بيانات الدخول أو مفاتيح API في المتصفح، وتعمل المزامنة المجدولة كل ساعة بعد تفعيلها في النسخة المنشورة.
              </p>
              <p className="helper-text">آخر مزامنة ناجحة: <strong>{formatSyncTime(vidmolyPortalSync?.lastSuccessAt)}</strong></p>
              {syncErrorText(vidmolyPortalSync?.lastErrorCode) ? <p className="helper-text">{syncErrorText(vidmolyPortalSync?.lastErrorCode)}</p> : null}
              {usageSyncMessage ? <p className="helper-text">{usageSyncMessage}</p> : null}
              <button type="button" className="btn" onClick={syncVidmolyUsage} disabled={usageSyncing}>
                <i className="fas fa-sync-alt" /> {usageSyncing ? 'جارٍ مزامنة الاستهلاك...' : 'مزامنة الآن من البوابة'}
              </button>
            </div>
          </div>
        ) : null}

        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'جارٍ الحفظ...' : 'حفظ كل التعديلات'}
        </button>
      </div>
    </Layout>
  );
}
