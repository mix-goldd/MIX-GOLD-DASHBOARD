import { useEffect, useMemo, useState } from 'react';
import Layout from '../../components/Layout';
import Dropdown from '../../components/Dropdown';
import { getSessionFromReq } from '../../lib/auth';
import { calculateVideoSizeSummary } from '../../lib/videoSizeComparison';

export async function getServerSideProps({ req }) {
  const session = getSessionFromReq(req);
  if (!session) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  return { props: { session } };
}

function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return 'Not available';
  const n = Number(bytes);
  // A non-breaking space keeps the number and unit glued together
  // ("1007.48 KB") so they never split across two lines.
  if (!n) return '0\u00A0KB';
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(2)}\u00A0KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(2)}\u00A0MB`;
  return `${(n / 1024 ** 3).toFixed(2)}\u00A0GB`;
}

function formatDuration(seconds) {
  const n = Number(seconds);
  if (!n) return '—';
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSignedSize(bytes) {
  if (bytes === null || bytes === undefined) return 'Not available';
  const n = Number(bytes);
  if (!Number.isFinite(n)) return 'Not available';
  return `${n > 0 ? '+' : ''}${formatSize(Math.abs(n))}`;
}

export default function Dashboard({ session }) {
  const [earnings, setEarnings] = useState(null);
  const [files, setFiles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [totalSize, setTotalSize] = useState(null);
  const [folderFilter, setFolderFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [debugSample, setDebugSample] = useState(null);
  const [fetchWarning, setFetchWarning] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [moveTarget, setMoveTarget] = useState('');
  const [moving, setMoving] = useState(false);
  const [moveStatus, setMoveStatus] = useState(null);

  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderParent, setNewFolderParent] = useState('');
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderActionStatus, setFolderActionStatus] = useState(null);
  const [editingFolderId, setEditingFolderId] = useState(null);
  const [editingFolderName, setEditingFolderName] = useState('');

  const [editingFileCode, setEditingFileCode] = useState(null);
  const [editingFileTitle, setEditingFileTitle] = useState('');
  const [fileBusy, setFileBusy] = useState(false);
  const [fileActionStatus, setFileActionStatus] = useState(null);
  const [libraryFolders, setLibraryFolders] = useState([]);
  const [sourceWarnings, setSourceWarnings] = useState([]);
  const [vidmolyKeys, setVidmolyKeys] = useState([]);
  const [sizeMeasurementStatus, setSizeMeasurementStatus] = useState({});
  const [quotaExpanded, setQuotaExpanded] = useState(false);
  const [quotaError, setQuotaError] = useState('');
  const [quotaClock, setQuotaClock] = useState(Date.now());
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  async function loadEarnings() {
    const res = await fetch('/api/doodstream/earnings');
    const data = await res.json();
    if (res.ok && data.status === 200) setEarnings(data.result);
  }

  async function loadLibrary() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/doodstream/library');
      const data = await res.json();
      if (!res.ok || data.status !== 200) {
        setError(data.error || 'Could not load videos.');
        setFiles([]);
      } else {
        setFiles(data.result.files || []);
        setFolders(data.result.folders || []);
        setLibraryFolders(data.result.libraryFolders || []);
        setTotalSize(data.result.totalSize ?? null);
        setSourceWarnings(data.result.sourceWarnings || []);
      }
    } catch (err) {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  async function loadFolders() {
    try {
      const res = await fetch('/api/doodstream/folders?all=1');
      const data = await res.json();
      if (res.ok && data.status === 200) setFolders(data.result?.folders || []);
    } catch (err) {
      // The next full library load will pick folders up too — safe to ignore.
    }
  }

  useEffect(() => {
    loadEarnings();
    loadLibrary();
  }, []);

  // Measure missing sizes once per file, sequentially. The server persists an
  // attempted marker, so a page refresh cannot repeat the Vidmoly request.
  useEffect(() => {
    if (loading || !files.length) return undefined;
    let cancelled = false;
    const missing = files.filter((file) => file.size === null || file.size === undefined);
    if (!missing.length) return undefined;

    async function measureMissingSizes() {
      for (const file of missing) {
        if (cancelled || !file.file_code || !file.sourceAccountId) continue;
        const measurementKey = `vidmoly-size-attempted:${file.file_code}`;
        if (typeof window !== 'undefined' && window.localStorage.getItem(measurementKey)) {
          setSizeMeasurementStatus((current) => ({ ...current, [file.file_code]: 'unavailable' }));
          continue;
        }
        if (typeof window !== 'undefined') window.localStorage.setItem(measurementKey, new Date().toISOString());
        setSizeMeasurementStatus((current) => ({ ...current, [file.file_code]: 'measuring' }));
        try {
          const res = await fetch('/api/doodstream/measure-size', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileCode: file.file_code, sourceAccountId: file.sourceAccountId }),
          });
          const data = await res.json();
          if (cancelled) return;
          if (data.sizeBytes !== null && data.sizeBytes !== undefined) {
            setFiles((current) => current.map((item) => item.file_code === file.file_code ? { ...item, size: data.sizeBytes } : item));
            setSizeMeasurementStatus((current) => ({ ...current, [file.file_code]: 'measured' }));
          } else {
            setSizeMeasurementStatus((current) => ({ ...current, [file.file_code]: 'unavailable' }));
          }
        } catch (error) {
          if (!cancelled) setSizeMeasurementStatus((current) => ({ ...current, [file.file_code]: 'unavailable' }));
        }
      }
    }

    measureMissingSizes();
    return () => { cancelled = true; };
  }, [loading, files.length]);

  useEffect(() => {
    if (session.role !== 'admin') return undefined;
    let cancelled = false;
    async function loadQuotaStatus() {
      try {
        const res = await fetch('/api/api-keys/status');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load account usage.');
        if (!cancelled) {
          setVidmolyKeys((data.keys || []).filter((key) => key.provider === 'vidmoly'));
          setQuotaError('');
        }
      } catch (err) {
        if (!cancelled) setQuotaError(err.message);
      }
    }
    loadQuotaStatus();
    const refreshTimer = setInterval(loadQuotaStatus, 30000);
    const clockTimer = setInterval(() => setQuotaClock(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearInterval(refreshTimer);
      clearInterval(clockTimer);
    };
  }, [session.role]);

  function handleSearchSubmit(e) {
    e.preventDefault();
    setFolderFilter('all');
    setCurrentPage(1);
  }

  const visibleFiles = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return files.filter((file) => {
      const inFolder = folderFilter === 'all' || file.folder?.key === folderFilter;
      const matchesSearch = !normalizedSearch || `${file.title || ''} ${file.file_code || ''}`.toLowerCase().includes(normalizedSearch);
      return inFolder && matchesSearch;
    });
  }, [files, folderFilter, search]);

  const totalPages = Math.max(1, Math.ceil(visibleFiles.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * pageSize;
  const pagedFiles = visibleFiles.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    setCurrentPage((page) => Math.min(Math.max(page, 1), totalPages));
  }, [totalPages]);

  const configuredVidmolyKeys = vidmolyKeys.filter((key) => key.configured);
  const quotaRequestsUsed = configuredVidmolyKeys.reduce((sum, key) => sum + (Number(key.dailyRequests) || 0), 0);
  const quotaRequestsLimit = configuredVidmolyKeys.reduce((sum, key) => sum + (Number(key.dailyLimit) || 0), 0);

  function formatQuotaCountdown(nextAvailableAt) {
    if (!nextAvailableAt) return '—';
    const remaining = Math.max(0, Number(nextAvailableAt) - quotaClock);
    if (!remaining) return 'متاح الآن';
    const seconds = Math.floor(remaining / 1000);
    const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const secs = String(seconds % 60).padStart(2, '0');
    return `${hours}:${minutes}:${secs}`;
  }

  function getQuotaStateLabel(key) {
    if (!key.configured) return 'غير مضاف';
    if (key.state === 'waiting') return 'بانتظار التجدد';
    return 'متاح';
  }

  function getQuotaRenewalText(key) {
    if (!key.configured) return 'أضف مفتاحًا';
    if (key.state === 'waiting') {
      const reason = Number(key.dailyRequests) >= Number(key.dailyLimit)
        ? 'اكتمل الحد اليومي'
        : key.lastError === 'rate_limited'
          ? 'إيقاف مؤقت من المزود'
          : 'بانتظار التجدد';
      return `${reason} — يتجدد خلال ${formatQuotaCountdown(key.nextAvailableAt)}`;
    }
    return 'جاهز للطلبات الآن';
  }

  function getUsageSourceText(key) {
    if (key.usageSource === 'provider') {
      return key.usageSyncedAt
        ? `متزامن من بوابة Vidmoly — ${new Date(Number(key.usageSyncedAt)).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}`
        : 'متزامن من بوابة Vidmoly';
    }
    if (key.usageSource === 'provider_plus_local') {
      return 'متزامن من بوابة Vidmoly + طلبات اللوحة اللاحقة';
    }
    return 'طلبات صادرة من لوحة التحكم فقط';
  }

  const waitingVidmolyKeys = configuredVidmolyKeys.filter((key) => key.state === 'waiting' && Number(key.nextAvailableAt) > quotaClock);
  const nextVidmolyRenewalAt = waitingVidmolyKeys.reduce((earliest, key) => (
    !earliest || Number(key.nextAvailableAt) < earliest ? Number(key.nextAvailableAt) : earliest
  ), null);
  const availableVidmolyAccounts = configuredVidmolyKeys.filter((key) => key.state === 'available').length;

  const selectedFiles = useMemo(() => files.filter((file) => selected.has(file.row_id)), [files, selected]);
  const selectedAccountId = selectedFiles[0]?.sourceAccountId || null;
  const selectionUsesOneAccount = selectedFiles.every((file) => file.sourceAccountId === selectedAccountId);
  const allVisibleSelected =
    pagedFiles.length > 0 && pagedFiles.every((file) => selected.has(file.row_id));
  const measuredFileSizes = useMemo(() => {
    const summary = calculateVideoSizeSummary(files);
    return { total: summary.totalBytes, count: summary.measuredCount };
  }, [files]);
  const providerStorageUsed = earnings?.storageUsed ?? null;
  const storageDifference = measuredFileSizes.total !== null && providerStorageUsed !== null
    ? measuredFileSizes.total - Number(providerStorageUsed)
    : null;

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        pagedFiles.forEach((file) => next.delete(file.row_id));
      } else {
        pagedFiles.forEach((file) => next.add(file.row_id));
      }
      return next;
    });
  }

  function toggleSelectOne(rowId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setMoveTarget('');
    setMoveStatus(null);
  }

  async function handleMoveSelected() {
    if (!selected.size || moveTarget === '') return;
    setMoving(true);
    setMoveStatus(null);
    if (!selectionUsesOneAccount) {
      setMoveStatus({ type: 'error', message: 'Select videos from one Vidmoly account before moving them.' });
      setMoving(false);
      return;
    }
    try {
      const results = await Promise.all(
        selectedFiles.map((file) =>
          fetch(`/api/doodstream/files/${file.file_code}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fld_id: moveTarget, sourceAccountId: file.sourceAccountId }),
          }).then((res) => res.json().then((data) => ({ ok: res.ok && data.status === 200, data })))
        )
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length) {
        setMoveStatus({
          type: 'error',
          message: `Moved ${selectedFiles.length - failed.length} of ${selectedFiles.length} — ${failed.length} failed.`,
        });
      } else {
        setMoveStatus({ type: 'success', message: `Moved ${selectedFiles.length} video${selectedFiles.length === 1 ? '' : 's'}.` });
      }
      setSelected(new Set());
      setMoveTarget('');
      loadLibrary(search);
    } catch (err) {
      setMoveStatus({ type: 'error', message: 'Could not reach the server.' });
    } finally {
      setMoving(false);
    }
  }

  const moveFolderOptions = selectedAccountId && selectionUsesOneAccount
    ? [
        { value: '0', label: 'Root (no folder)' },
        ...libraryFolders
          .filter((folder) => folder.accountId === selectedAccountId)
          .map((folder) => ({ value: String(folder.fld_id), label: folder.name })),
      ]
    : [];

  async function handleDeleteSelected() {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} selected video(s)? This can't be undone.`)) return;
    setMoving(true);
    setMoveStatus(null);
    try {
      const results = await Promise.all(
        selectedFiles.map((file) => {
          return fetch(`/api/doodstream/files/${file.file_code}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: file?.title, thumb: file?.thumb, sourceAccountId: file.sourceAccountId }),
          }).then((res) => res.json().then((data) => ({ ok: res.ok && data.status === 200, data })));
        })
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length) {
        setMoveStatus({
          type: 'error',
          message: `Deleted ${selectedFiles.length - failed.length} of ${selectedFiles.length} — ${failed.length} failed.`,
        });
      } else {
        setMoveStatus({ type: 'success', message: `Deleted ${selectedFiles.length} video${selectedFiles.length === 1 ? '' : 's'}.` });
      }
      setSelected(new Set());
      setMoveTarget('');
      loadLibrary(search);
      window.dispatchEvent(new Event('doodops:notify-refresh'));
    } catch (err) {
      setMoveStatus({ type: 'error', message: 'Could not reach the server.' });
    } finally {
      setMoving(false);
    }
  }

  // ---- Folder management ----
  async function handleCreateFolder(e) {
    e.preventDefault();
    if (!newFolderName.trim() || folderBusy) return;
    setFolderBusy(true);
    setFolderActionStatus(null);
    try {
      const res = await fetch('/api/doodstream/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newFolderName.trim(),
          ...(newFolderParent ? { parent_id: newFolderParent } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== 200) {
        setFolderActionStatus({ type: 'error', message: data.error || data.msg || 'Could not create the folder.' });
        return;
      }
      setNewFolderName('');
      setNewFolderParent('');
      loadFolders();
    } catch (err) {
      setFolderActionStatus({ type: 'error', message: 'Could not reach the server.' });
    } finally {
      setFolderBusy(false);
    }
  }

  function startRenameFolder(folder) {
    setEditingFolderId(folder.fld_id);
    setEditingFolderName(folder.name);
  }
  function cancelRenameFolder() {
    setEditingFolderId(null);
    setEditingFolderName('');
  }
  async function saveRenameFolder(fldId) {
    if (!editingFolderName.trim() || folderBusy) return;
    setFolderBusy(true);
    setFolderActionStatus(null);
    try {
      const res = await fetch(`/api/doodstream/folders/${fldId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingFolderName.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== 200) {
        setFolderActionStatus({ type: 'error', message: data.error || data.msg || 'Could not rename the folder.' });
        return;
      }
      cancelRenameFolder();
      loadFolders();
      loadLibrary(search);
    } catch (err) {
      setFolderActionStatus({ type: 'error', message: 'Could not reach the server.' });
    } finally {
      setFolderBusy(false);
    }
  }

  async function handleDeleteFolder(folder) {
    if (!confirm(`Delete folder "${folder.name}"? This can't be undone.`)) return;
    setFolderBusy(true);
    setFolderActionStatus(null);
    try {
      const res = await fetch(`/api/doodstream/folders/${folder.fld_id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || data.status !== 200) {
        setFolderActionStatus({ type: 'error', message: data.error || data.msg || 'Could not delete the folder.' });
        return;
      }
      if (folderFilter === String(folder.fld_id)) setFolderFilter('all');
      loadFolders();
      loadLibrary(search);
    } catch (err) {
      setFolderActionStatus({ type: 'error', message: 'Could not reach the server.' });
    } finally {
      setFolderBusy(false);
    }
  }

  // ---- File rename / delete ----
  function startRenameFile(file) {
    setEditingFileCode(file.row_id);
    setEditingFileTitle(file.title);
  }
  function cancelRenameFile() {
    setEditingFileCode(null);
    setEditingFileTitle('');
  }
  async function saveRenameFile(file) {
    if (!editingFileTitle.trim() || fileBusy) return;
    setFileBusy(true);
    setFileActionStatus(null);
    try {
      const res = await fetch(`/api/doodstream/files/${file.file_code}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editingFileTitle.trim(), sourceAccountId: file.sourceAccountId }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== 200) {
        setFileActionStatus({ type: 'error', message: data.error || data.msg || 'Could not rename the video.' });
        return;
      }
      cancelRenameFile();
      loadLibrary(search);
    } catch (err) {
      setFileActionStatus({ type: 'error', message: 'Could not reach the server.' });
    } finally {
      setFileBusy(false);
    }
  }

  async function handleDeleteFile(file) {
    if (!confirm(`Delete "${file.title}"? This can't be undone.`)) return;
    setFileBusy(true);
    setFileActionStatus(null);
    try {
      const res = await fetch(`/api/doodstream/files/${file.file_code}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: file.title, thumb: file.thumb, sourceAccountId: file.sourceAccountId }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== 200) {
        setFileActionStatus({ type: 'error', message: data.error || data.msg || 'Could not delete the video.' });
        return;
      }
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(file.row_id);
        return next;
      });
      loadLibrary(search);
      window.dispatchEvent(new Event('doodops:notify-refresh'));
    } catch (err) {
      setFileActionStatus({ type: 'error', message: 'Could not reach the server.' });
    } finally {
      setFileBusy(false);
    }
  }

  return (
    <Layout title="Videos" session={session}>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-card-label">Calculated Video Size</div>
          <div className="stat-card-value">{formatSize(measuredFileSizes.total ?? totalSize)}</div>
          <div className="stat-card-sub">sum of {measuredFileSizes.count} measured file{measuredFileSizes.count === 1 ? '' : 's'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Vidmoly Storage Comparison</div>
          <div className="stat-card-value stat-card-accent">{formatSignedSize(storageDifference)}</div>
          <div className="stat-card-sub">
            Files: {formatSize(measuredFileSizes.total ?? totalSize)} · Vidmoly: {formatSize(providerStorageUsed)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Total Videos</div>
          <div className="stat-card-value stat-card-accent">{files.length}</div>
          <div className="stat-card-sub">Across all available Vidmoly accounts</div>
        </div>
        {session.role === 'admin' && (
          <div className="stat-card">
            <div className="stat-card-label">API Requests Today</div>
            <div className="stat-card-value stat-card-accent">{quotaRequestsUsed} / {quotaRequestsLimit || '—'}</div>
            <div className="stat-card-sub">{configuredVidmolyKeys.length} configured Vidmoly account{configuredVidmolyKeys.length === 1 ? '' : 's'}</div>
          </div>
        )}
      </div>

      {session.role === 'admin' && (
        <div className="card api-key-panel">
          <div className="am-row-between">
            <div>
              <h2>Vidmoly account usage</h2>
              <p className="helper-text">تظهر الاستخدامات بدون كشف مفاتيح الحسابات. يوضح كل صف مصدر الرقم حتى لا تُفهم طلبات اللوحة المحلية على أنها عداد حي من Vidmoly.</p>
            </div>
            <button type="button" className="btn" onClick={() => setQuotaExpanded((value) => !value)} aria-expanded={quotaExpanded}>
              <i className={`fas ${quotaExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}`} />
              {quotaExpanded ? 'إخفاء تفاصيل الحسابات' : 'عرض تفاصيل الحسابات'}
            </button>
          </div>
          <div className="vidmoly-usage-summary" aria-live="polite">
            <div className="vidmoly-usage-metric">
              <span>إجمالي طلبات اليوم</span>
              <strong className="mono">{quotaRequestsUsed} / {quotaRequestsLimit || '—'}</strong>
            </div>
            <div className="vidmoly-usage-metric">
              <span>الحسابات المتاحة</span>
              <strong>{availableVidmolyAccounts} / {configuredVidmolyKeys.length || '—'}</strong>
            </div>
            <div className="vidmoly-usage-metric vidmoly-usage-renewal">
              <span>أقرب تجدد للحصة</span>
              <strong className="api-key-countdown">{nextVidmolyRenewalAt ? formatQuotaCountdown(nextVidmolyRenewalAt) : 'لا يوجد انتظار'}</strong>
            </div>
          </div>
          {quotaError && <div className="banner banner-warning">{quotaError}</div>}
          {quotaExpanded && (
            <div className="api-key-table-wrap">
              <table className="api-key-table">
                <thead>
                  <tr>
                    <th>الحساب</th>
                    <th>طلبات اليوم</th>
                    <th>الحد</th>
                    <th>المتبقي</th>
                    <th>مصدر الرقم</th>
                    <th>الحالة</th>
                    <th>التجدد</th>
                  </tr>
                </thead>
                <tbody>
                  {vidmolyKeys.map((key) => {
                    const remaining = Math.max(0, (Number(key.dailyLimit) || 0) - (Number(key.dailyRequests) || 0));
                    return (
                      <tr key={key.id}>
                        <td className="api-key-mask" data-label="الحساب"><i className="fas fa-key" />{key.label}</td>
                        <td className="mono" data-label="طلبات اليوم">{key.configured ? key.dailyRequests : '—'}</td>
                        <td className="mono" data-label="الحد">{key.configured ? key.dailyLimit : '—'}</td>
                        <td className="mono" data-label="المتبقي">{key.configured ? remaining : '—'}</td>
                        <td data-label="مصدر الرقم">{key.configured ? getUsageSourceText(key) : '—'}</td>
                        <td data-label="الحالة"><span className={`api-key-state api-key-state-${key.state}`}>{getQuotaStateLabel(key)}</span></td>
                        <td className="api-key-countdown" data-label="التجدد">{getQuotaRenewalText(key)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2>Earnings</h2>
        {earnings ? (
          <>
          <table>
            <tbody>
              <tr>
                <td>Today</td>
                <td className="mono">${earnings.today}</td>
              </tr>
              <tr>
                <td>Yesterday</td>
                <td className="mono">${earnings.yesterday}</td>
              </tr>
              <tr>
                <td>Total earnings</td>
                <td className="mono balance-value">${earnings.total ?? earnings.balance}</td>
              </tr>
              <tr>
                <td>Balance</td>
                <td className="mono">${earnings.balance}</td>
              </tr>
            </tbody>
          </table>
          <p className="helper-text">Total combines Vidmoly balance with Adsterra current-month revenue.</p>
          {earnings?.earningsSources?.adsterra?.error && (
            <p className="helper-text">Adsterra is unavailable; the total currently includes Vidmoly only.</p>
          )}
          </>
        ) : (
          <p className="helper-text">Loading…</p>
        )}
      </div>

      <div className="card">
        <h2>Folders</h2>
        <form className="toolbar" onSubmit={handleCreateFolder}>
          <input
            type="text"
            placeholder="New folder name…"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
          />
          <Dropdown
            value={newFolderParent}
            onChange={setNewFolderParent}
            placeholder="Inside…"
            options={[{ value: '', label: 'Root' }, ...folders.map((f) => ({ value: String(f.fld_id), label: f.name }))]}
          />
          <button type="submit" className="btn btn-primary" disabled={folderBusy || !newFolderName.trim()}>
            <i className="fas fa-plus" /> Add folder
          </button>
        </form>

        {folderActionStatus && (
          <div className={`banner ${folderActionStatus.type === 'error' ? 'banner-error' : 'banner-success'}`}>
            {folderActionStatus.message}
          </div>
        )}

        {folders.length === 0 ? (
          <p className="helper-text">No folders yet.</p>
        ) : (
          <div className="folder-manage-list">
            {folders.map((folder) =>
              editingFolderId === folder.fld_id ? (
                <div className="folder-manage-row" key={folder.fld_id}>
                  <input
                    type="text"
                    value={editingFolderName}
                    onChange={(e) => setEditingFolderName(e.target.value)}
                    autoFocus
                  />
                  <button className="btn btn-primary" onClick={() => saveRenameFolder(folder.fld_id)} disabled={folderBusy}>
                    Save
                  </button>
                  <button className="btn" onClick={cancelRenameFolder} disabled={folderBusy}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="folder-manage-row" key={folder.fld_id}>
                  <span className="folder-badge">{folder.name}</span>
                  <div className="am-item-actions">
                    <button onClick={() => startRenameFolder(folder)} title="Rename" disabled={folderBusy}>
                      <i className="fas fa-pencil-alt" />
                    </button>
                    <button onClick={() => handleDeleteFolder(folder)} title="Delete" disabled={folderBusy}>
                      <i className="fas fa-trash" />
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Library</h2>
        <form className="toolbar" onSubmit={handleSearchSubmit}>
          <input
            type="search"
            placeholder="Search videos by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="btn">
            Search
          </button>
          {search && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setSearch('');
                setCurrentPage(1);
                loadLibrary('');
              }}
            >
              Clear
            </button>
          )}
        </form>

        {libraryFolders.length > 0 && (
          <div className="field" style={{ maxWidth: 260 }}>
            <Dropdown
              value={folderFilter}
              onChange={(value) => {
                setFolderFilter(value);
                setCurrentPage(1);
              }}
              options={[{ value: 'all', label: 'All folders' }, ...libraryFolders.map((folder) => ({ value: folder.key, label: folder.label }))]}
            />
          </div>
        )}

        {selected.size > 0 && (
          <div className="toolbar bulk-move-bar">
            <span className="helper-text">{selected.size} selected</span>
            <Dropdown
              value={moveTarget}
              onChange={setMoveTarget}
              placeholder="Move to folder…"
              options={moveFolderOptions}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleMoveSelected}
              disabled={moving || moveTarget === ''}
            >
              {moving ? 'Working…' : 'Move'}
            </button>
            <button type="button" className="btn btn-danger" onClick={handleDeleteSelected} disabled={moving}>
              Delete
            </button>
            <button type="button" className="btn" onClick={clearSelection} disabled={moving}>
              Clear
            </button>
          </div>
        )}

        {moveStatus && (
          <div className={`banner ${moveStatus.type === 'error' ? 'banner-error' : 'banner-success'}`}>
            {moveStatus.message}
          </div>
        )}

        {fileActionStatus && (
          <div className={`banner ${fileActionStatus.type === 'error' ? 'banner-error' : 'banner-success'}`}>
            {fileActionStatus.message}
          </div>
        )}

        {error && <div className="banner banner-error">{error}</div>}
        {sourceWarnings.length > 0 && (
          <div className="banner banner-warning">
            <strong>تعذر تحديث بعض حسابات Vidmoly بالكامل.</strong> لا تزال نتائج الحسابات المتاحة موجودة في الجدول الموحد.
            <ul className="quota-warning-list">
              {sourceWarnings.map((warning, index) => (
                <li key={`${typeof warning === 'string' ? warning : warning.accountLabel}-${index}`}>
                  {typeof warning === 'string' ? warning : (
                    <>
                      <strong>{warning.accountLabel}:</strong>{' '}
                      {getQuotaRenewalText(vidmolyKeys.find((key) => key.label === warning.accountLabel) || { configured: true, state: 'waiting', nextAvailableAt: warning.waitUntil })}.
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {earnings?.accountRaw && (
          <div className="banner banner-warning">
            Storage isn&apos;t showing because Account Info&apos;s response doesn&apos;t use any of the field
            names this page tried. Screenshot this so it can be fixed for real:
            <br />
            {JSON.stringify(earnings.accountRaw)}
          </div>
        )}
        {debugSample && (
          <div className="banner banner-warning">
            Size and/or thumbnail are blank for at least one video — Vidmoly&apos;s response doesn&apos;t use
            the field names this page expected. Screenshot this so it can be fixed for real:
            <br />
            {JSON.stringify(debugSample)}
          </div>
        )}

        {loading ? (
          <p className="helper-text">Loading…</p>
        ) : visibleFiles.length === 0 ? (
          <div className="empty-state">
            <span className="tally-dot" />
            <p>No videos yet — add one to get started.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      aria-label="Select all"
                    />
                  </th>
                  <th></th>
                  <th>Title</th>
                  <th>ID</th>
                  <th>Account</th>
                  <th>Folder</th>
                  <th>Duration</th>
                  <th>Views</th>
                  <th>Size</th>
                  <th>Uploaded</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedFiles.map((file) => (
                  <tr key={file.row_id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(file.row_id)}
                        onChange={() => toggleSelectOne(file.row_id)}
                        aria-label={`Select ${file.title}`}
                      />
                    </td>
                    <td>
                      {file.thumb ? (
                        <img src={file.thumb} alt="" className="thumb" />
                      ) : (
                        <div className="thumb thumb-empty" />
                      )}
                    </td>
                    <td>
                      {editingFileCode === file.row_id ? (
                        <input
                          type="text"
                          className="inline-rename-input"
                          value={editingFileTitle}
                          onChange={(e) => setEditingFileTitle(e.target.value)}
                          autoFocus
                        />
                      ) : (
                        <div className="file-title" title={file.title}>
                          {file.title}
                        </div>
                      )}
                    </td>
                    <td className="mono file-code">{file.file_code}</td>
                    <td><span className="folder-badge">{file.sourceAccountLabel}</span></td>
                    <td>
                      {file.folder ? (
                        <span className="folder-badge">{file.folder.name}</span>
                      ) : (
                        <span className="helper-text">—</span>
                      )}
                    </td>
                    <td className="mono">{formatDuration(file.length)}</td>
                    <td>{file.views ?? '—'}</td>
                    <td className="mono nowrap">
                      {file.size !== null && file.size !== undefined
                        ? formatSize(file.size)
                        : sizeMeasurementStatus[file.file_code] === 'measuring'
                          ? 'Measuring…'
                          : sizeMeasurementStatus[file.file_code] === 'unavailable'
                            ? 'غير متاح من Vidmoly'
                            : '—'}
                    </td>
                    <td>{file.uploaded}</td>
                    <td>
                      {editingFileCode === file.row_id ? (
                        <div className="am-item-actions">
                          <button onClick={() => saveRenameFile(file)} title="Save" disabled={fileBusy}>
                            <i className="fas fa-check" />
                          </button>
                          <button onClick={cancelRenameFile} title="Cancel" disabled={fileBusy}>
                            <i className="fas fa-times" />
                          </button>
                        </div>
                      ) : (
                        <div className="am-item-actions">
                          <button onClick={() => startRenameFile(file)} title="Rename" disabled={fileBusy}>
                            <i className="fas fa-pencil-alt" />
                          </button>
                          <button onClick={() => handleDeleteFile(file)} title="Delete" disabled={fileBusy}>
                            <i className="fas fa-trash" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {visibleFiles.length > 0 && (
          <div className="table-pagination" aria-label="Library pagination">
            <span className="helper-text">
              Showing {pageStart + 1}–{Math.min(pageStart + pageSize, visibleFiles.length)} of {visibleFiles.length} videos
            </span>
            <div className="table-pagination-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={safeCurrentPage === 1}
              >
                Previous
              </button>
              <span className="mono pagination-status">{safeCurrentPage} / {totalPages}</span>
              <button
                type="button"
                className="btn"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={safeCurrentPage === totalPages}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
