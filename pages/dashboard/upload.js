import { useEffect, useRef, useState } from 'react';
import Layout from '../../components/Layout';
import Dropdown from '../../components/Dropdown';
import { getSessionFromReq } from '../../lib/auth';
import { formatDuration } from '../../lib/animeContent';
const {
  VIDMOLY_STATUS_POLL_INTERVAL_MS,
  MAX_VIDMOLY_STATUS_POLLS,
  canPollVidmolyStatus,
  shouldContinueVidmolyStatusPolling,
} = require('../../lib/vidmolyStatusPolling');

export async function getServerSideProps({ req }) {
  const session = getSessionFromReq(req);
  if (!session) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  return { props: { session } };
}

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `q${Date.now()}_${idCounter}`;
}

function formatBytes(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function formatEta(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  if (seconds < 1) return 'almost done';
  if (seconds < 60) return `${Math.ceil(seconds)}s left`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${s}s left`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m left`;
}

// Uploads via XMLHttpRequest (not fetch) so we can read real upload
// progress events for the % / size / ETA display.
function uploadWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (err) {
        reject(new Error('Invalid response from server.'));
        return;
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, data });
    };
    xhr.onerror = () => reject(new Error('Network error.'));
    xhr.send(formData);
  });
}

// Vidmoly's remote-upload status field names aren't confirmed against
// a live account here, so this reads several plausible variants and
// falls back to an indeterminate "downloading" state if none match. When
// none match, `rawKeys` carries the actual response through so the UI can
// surface it — screenshot that instead of us guessing field names again.
function ProgressBar({ pct }) {
  const known = pct !== null && pct !== undefined;
  return (
    <div className="progress-track">
      <div
        className={`progress-fill ${known ? '' : 'progress-fill-indeterminate'}`}
        style={known ? { width: `${Math.max(2, Math.round(pct))}%` } : undefined}
      />
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    pending: { label: 'Waiting…', cls: 'status-pill-pending' },
    uploading: { label: 'Uploading…', cls: 'status-pill-active' },
    downloading: { label: 'Downloading…', cls: 'status-pill-active' },
    queuing: { label: 'Queuing…', cls: 'status-pill-pending' },
    done: { label: 'Done', cls: '' },
    error: { label: 'Failed', cls: 'status-pill-error' },
  };
  const info = map[status] || { label: status, cls: '' };
  return <span className={`status-pill ${info.cls}`}>{info.label}</span>;
}

export default function Upload({ session }) {
  const [folders, setFolders] = useState([]);

  // ---------- Upload from a link (supports multiple links) ----------
  const [urlRows, setUrlRows] = useState([{ id: nextId(), url: '', title: '' }]);
  const [urlFolder, setUrlFolder] = useState('');
  const [urlSubmitting, setUrlSubmitting] = useState(false);
  const [urlQueue, setUrlQueue] = useState([]);

  // ---------- Upload from device (supports multiple files) ----------
  const [localFiles, setLocalFiles] = useState([]);
  const [localFolder, setLocalFolder] = useState('');
  const [localRunning, setLocalRunning] = useState(false);
  const [localQueue, setLocalQueue] = useState([]);

  useEffect(() => {
    loadFolders();
  }, []);

  function loadFolders() {
    fetch('/api/doodstream/folders?all=1')
      .then((res) => res.json())
      .then((data) => {
        if (data.status === 200) setFolders(data.result?.folders || []);
      })
      .catch(() => {});
  }

  const folderOptions = [
    { value: '', label: 'No folder (root)' },
    ...folders.map((f) => ({ value: String(f.fld_id), label: f.name })),
  ];

  // ---- URL rows ----
  function addUrlRow() {
    setUrlRows((rows) => [...rows, { id: nextId(), url: '', title: '' }]);
  }
  function removeUrlRow(id) {
    setUrlRows((rows) => (rows.length > 1 ? rows.filter((r) => r.id !== id) : rows));
  }
  function updateUrlRow(id, patch) {
    setUrlRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function handleUrlSubmit(e) {
    e.preventDefault();
    const valid = urlRows.filter((r) => r.url.trim());
    if (!valid.length || urlSubmitting) return;
    setUrlSubmitting(true);

    const queued = valid.map((r) => ({
      id: r.id,
      url: r.url,
      title: r.title,
      status: 'queuing',
      message: '',
      fileCode: null,
      length: null,
      thumb: null,
      renamed: !r.title, // nothing to rename to → treat as already settled
    }));
    setUrlQueue((prev) => [...queued, ...prev]);
    setUrlRows([{ id: nextId(), url: '', title: '' }]);

    await Promise.all(
      valid.map(async (r) => {
        try {
          const res = await fetch('/api/doodstream/upload-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: r.url,
              ...(r.title ? { new_title: r.title } : {}),
              ...(urlFolder ? { fld_id: urlFolder } : {}),
            }),
          });
          const data = await res.json();
          if (!res.ok || data.status !== 200) {
            setUrlQueue((prev) =>
              prev.map((item) =>
                item.id === r.id
                  ? { ...item, status: 'error', message: data.error || data.msg || 'Failed to queue.' }
                  : item
              )
            );
            return;
          }
          if (!data.filecode) {
            // Queued on Vidmoly's side, but we couldn't find an
            // identifier to track it by — same screenshot-and-fix
            // pattern as elsewhere, the raw response is right there.
            setUrlQueue((prev) =>
              prev.map((item) =>
                item.id === r.id
                  ? { ...item, status: 'error', message: `Queued, but couldn't find its file code to track progress.\n${JSON.stringify(data.raw)}` }
                  : item
              )
            );
            return;
          }
          setUrlQueue((prev) =>
            prev.map((item) =>
              item.id === r.id
                ? {
                    ...item,
                    status: 'downloading',
                    fileCode: data.filecode,
                    sourceSize: data.size || null,
                    startedAt: Date.now(),
                    pollCount: 0,
                    lastPolledAt: null,
                  }
                : item
            )
          );
        } catch (err) {
          setUrlQueue((prev) =>
            prev.map((item) =>
              item.id === r.id ? { ...item, status: 'error', message: 'Could not reach the server.' } : item
            )
          );
        }
      })
    );

    setUrlSubmitting(false);
  }

  // Real per-item progress isn't available from Vidmoly at all (no
  // confirmed endpoint for it — see upload-url/[code].js), but the
  // source URL's real byte size IS known upfront (captured via
  // Content-Length before the URL is even sent to Vidmoly — see
  // upload-url.js), so a plausible percentage/ETA can be estimated
  // client-side from elapsed time, entirely without extra requests.
  // ASSUMED_SPEED is a guess (server-to-server transfers vary a lot) —
  // capped at 99% and clearly labeled "تقريبًا" so it reads as an
  // estimate, never as a real measurement, and real completion always
  // comes from an actual Vidmoly check (see the polling effect below),
  // never from the estimate alone.
  const ASSUMED_SPEED_BYTES_PER_SEC = 3 * 1024 * 1024; // ~3 MB/s
  const [, forceTick] = useState(0);
  useEffect(() => {
    const anyDownloading = urlQueue.some((i) => i.status === 'downloading' && i.sourceSize);
    if (!anyDownloading) return undefined;
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [urlQueue]);

  function estimateProgress(item) {
    if (!item.sourceSize || !item.startedAt) return null;
    const elapsedSec = (Date.now() - item.startedAt) / 1000;
    const estimatedBytes = Math.min(item.sourceSize, elapsedSec * ASSUMED_SPEED_BYTES_PER_SEC);
    const pct = Math.min(99, (estimatedBytes / item.sourceSize) * 100);
    const remainingBytes = item.sourceSize - estimatedBytes;
    const etaSec = remainingBytes / ASSUMED_SPEED_BYTES_PER_SEC;
    return { pct, etaSec };
  }

  // Poll Vidmoly for each in-progress remote download to confirm actual
  // completion — the estimate above is never treated as "done" by
  // itself, only this real check is.
  //
  // Interval and cap are deliberately conservative: Vidmoly's real quota
  // is only 50 requests/day total (confirmed live), shared with every
  // other page in this dashboard. The original 3-second interval alone
  // could burn 100+ requests on a single download that takes a few
  // minutes — a big video can take far longer than that, so a fixed
  // short interval was never going to fit inside a 50/day budget no
  // matter how small library.js's own usage was. This checks once a
  // minute and gives up automatically after 15 tries (15 minutes),
  // after which the item just needs a manual look on the Videos page —
  // still far cheaper than one request every few seconds indefinitely.
  // `lastPolledAt` plus the in-flight guard make the one-request-per-minute
  // rule hold even when React rerenders or a slow request overlaps a timer.
  const pollingFileCodesRef = useRef(new Set());
  useEffect(() => {
    const active = urlQueue.filter(shouldContinueVidmolyStatusPolling);
    if (!active.length) return undefined;
    const interval = setInterval(() => {
      active.forEach(async (item) => {
        const now = Date.now();
        if (
          !canPollVidmolyStatus({
            lastPolledAt: item.lastPolledAt,
            now,
            inFlight: pollingFileCodesRef.current.has(item.fileCode),
          })
        ) {
          return;
        }

        pollingFileCodesRef.current.add(item.fileCode);
        // Count and timestamp the actual API attempt before making it, so a
        // retry, rerender, or network failure cannot create an extra request.
        setUrlQueue((prev) =>
          prev.map((q) =>
            q.fileCode === item.fileCode
              ? { ...q, pollCount: (q.pollCount || 0) + 1, lastPolledAt: now }
              : q
          )
        );
        try {
          const res = await fetch(`/api/doodstream/upload-url/${item.fileCode}`);
          const data = await res.json();
          if (!res.ok || data.status !== 200) {
            return; // transient — try again next tick
          }
          const { done, length, thumb, title } = data.result || {};
          if (!done) {
            return;
          }

          setUrlQueue((prev) =>
            prev.map((q) => (q.fileCode === item.fileCode ? { ...q, status: 'done', length, thumb } : q))
          );

          // Guarantees the typed title actually sticks — /upload/url's
          // new_title param isn't confirmed to be honored (see
          // upload-url.js), so this explicitly renames via the one
          // endpoint that IS confirmed (/file/rename) once the file
          // exists to rename. Skipped if nothing was typed, or Vidmoly
          // already reports the exact same title.
          if (item.title && item.title !== title) {
            try {
              const renameRes = await fetch(`/api/doodstream/files/${item.fileCode}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: item.title }),
              });
              const renameData = await renameRes.json();
              setUrlQueue((prev) =>
                prev.map((q) =>
                  q.fileCode === item.fileCode
                    ? { ...q, renamed: renameRes.ok && renameData.status === 200 }
                    : q
                )
              );
            } catch (err) {
              setUrlQueue((prev) => prev.map((q) => (q.fileCode === item.fileCode ? { ...q, renamed: false } : q)));
            }
          }
        } catch (err) {
          // Ignore transient polling errors — try again next tick.
        } finally {
          pollingFileCodesRef.current.delete(item.fileCode);
        }
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, VIDMOLY_STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [urlQueue]);

  function clearUrlQueue() {
    setUrlQueue((prev) => prev.filter((i) => i.status !== 'done' && i.status !== 'error'));
  }

  // ---- Local files ----
  function handleLocalFilesChange(e) {
    setLocalFiles((prev) => [...prev, ...Array.from(e.target.files || [])]);
    e.target.value = '';
  }
  function removeLocalFile(idx) {
    setLocalFiles((files) => files.filter((_, i) => i !== idx));
  }

  async function handleLocalSubmit(e) {
    e.preventDefault();
    if (!localFiles.length || localRunning) return;
    setLocalRunning(true);

    const queued = localFiles.map((file) => ({
      id: nextId(),
      name: file.name,
      size: file.size,
      status: 'pending',
      loaded: 0,
      total: file.size,
      pct: 0,
      eta: null,
      message: '',
      file,
    }));
    setLocalQueue((prev) => [...queued, ...prev]);
    setLocalFiles([]);

    for (const item of queued) {
      setLocalQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: 'uploading' } : q)));
      const startedAt = Date.now();
      try {
        const formData = new FormData();
        formData.append('file', item.file);
        if (localFolder) formData.append('fld_id', localFolder);

        // eslint-disable-next-line no-await-in-loop
        const { ok, data } = await uploadWithProgress('/api/doodstream/upload-local', formData, (loaded, total) => {
          const elapsed = (Date.now() - startedAt) / 1000;
          const speed = elapsed > 0.2 ? loaded / elapsed : 0;
          const remaining = total - loaded;
          const eta = speed > 0 ? remaining / speed : null;
          const pct = total ? Math.round((loaded / total) * 100) : 0;
          setLocalQueue((prev) =>
            prev.map((q) => (q.id === item.id ? { ...q, loaded, total, pct, eta } : q))
          );
        });

        if (!ok || data.status !== 200) {
          setLocalQueue((prev) =>
            prev.map((q) =>
              q.id === item.id
                ? { ...q, status: 'error', message: data.error || data.msg || 'Upload failed.' }
                : q
            )
          );
          // eslint-disable-next-line no-continue
          continue;
        }

        const result = Array.isArray(data.result) ? data.result[0] : data.result;
        setLocalQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  status: data.folder_move_warning ? 'error' : 'done',
                  pct: 100,
                  eta: null,
                  message: data.folder_move_warning || `Uploaded — "${result?.title || item.name}"`,
                }
              : q
          )
        );
      } catch (err) {
        setLocalQueue((prev) =>
          prev.map((q) =>
            q.id === item.id ? { ...q, status: 'error', message: 'Could not reach the server.' } : q
          )
        );
      }
    }

    setLocalRunning(false);
  }

  function clearLocalQueue() {
    setLocalQueue((prev) => prev.filter((i) => i.status !== 'done' && i.status !== 'error'));
  }

  return (
    <Layout title="Add video" session={session}>
      <div className="card">
        <h2>Upload from a link</h2>
        <p className="helper-text" style={{ marginTop: -8, marginBottom: 16 }}>
          Vidmoly downloads each file from its URL on its own servers, so this works even for
          large files. Add as many links as you need — they queue together.
        </p>
        <form onSubmit={handleUrlSubmit}>
          {urlRows.map((row, idx) => (
            <div className="url-row" key={row.id}>
              <input
                type="url"
                placeholder="https://example.com/video.mp4"
                value={row.url}
                onChange={(e) => updateUrlRow(row.id, { url: e.target.value })}
                required={idx === 0}
              />
              <input
                type="text"
                placeholder="Title (optional)"
                value={row.title}
                onChange={(e) => updateUrlRow(row.id, { title: e.target.value })}
              />
              {urlRows.length > 1 && (
                <button
                  type="button"
                  className="btn btn-icon"
                  onClick={() => removeUrlRow(row.id)}
                  aria-label="Remove link"
                  title="Remove"
                >
                  <i className="fas fa-times" />
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn" onClick={addUrlRow} style={{ marginBottom: 16 }}>
            <i className="fas fa-plus" /> Add another link
          </button>

          <div className="field">
            <label htmlFor="url-folder">Folder</label>
            <Dropdown id="url-folder" value={urlFolder} onChange={setUrlFolder} options={folderOptions} />
          </div>

          <button type="submit" className="btn btn-primary" disabled={urlSubmitting}>
            {urlSubmitting ? 'Queuing…' : urlRows.length > 1 ? 'Add links' : 'Add from link'}
          </button>
        </form>

        {urlQueue.length > 0 && (
          <div className="upload-queue">
            {urlQueue.map((item) => {
              const estimate = item.status === 'downloading' ? estimateProgress(item) : null;
              return (
                <div className="upload-item" key={item.id}>
                  <div className="upload-item-head">
                    <span className="upload-item-name">{item.title || item.url}</span>
                    <StatusPill status={item.status} />
                  </div>
                  {item.status === 'downloading' && <ProgressBar pct={estimate?.pct ?? null} />}
                  <div className="upload-item-meta">
                    {item.status === 'downloading' && estimate && (
                      <>
                        <span>~{Math.round(estimate.pct)}% (estimated)</span>
                        <span>{formatBytes(item.sourceSize)}</span>
                        <span>{formatEta(estimate.etaSec)} (estimated)</span>
                      </>
                    )}
                    {item.status === 'downloading' && !item.sourceSize && (
                      <span>Downloading on Vidmoly&apos;s side — the source didn&apos;t report a size, so no estimate is available.</span>
                    )}
                    {item.status === 'downloading' && (item.pollCount || 0) >= MAX_VIDMOLY_STATUS_POLLS && (
                      <span>Taking longer than estimated — stopped auto-checking to save today&apos;s request quota. Check the Videos page in a bit.</span>
                    )}
                    {item.status === 'done' && item.length ? <span>Duration: {formatDuration(item.length)}</span> : null}
                    {item.status === 'done' && item.title && item.renamed === false && (
                      <span>Uploaded, but the title may not have saved — check it on the Videos page.</span>
                    )}
                    {item.message && <span>{item.message}</span>}
                  </div>
                </div>
              );
            })}
            <button type="button" className="btn" onClick={clearUrlQueue}>
              Clear finished
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Upload from your device</h2>
        <form onSubmit={handleLocalSubmit}>
          <div className="field">
            <label htmlFor="file">Video files</label>
            <input id="file" type="file" accept="video/*" multiple onChange={handleLocalFilesChange} />
          </div>

          {localFiles.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              {localFiles.map((f, idx) => (
                <div className="pending-file-row" key={`${f.name}-${idx}`}>
                  <span className="upload-item-name">
                    {f.name} <span className="helper-text">({formatBytes(f.size)})</span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-icon"
                    onClick={() => removeLocalFile(idx)}
                    aria-label="Remove file"
                    title="Remove"
                  >
                    <i className="fas fa-times" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="field">
            <label htmlFor="file-folder">Folder</label>
            <Dropdown id="file-folder" value={localFolder} onChange={setLocalFolder} options={folderOptions} />
          </div>

          <button type="submit" className="btn btn-primary" disabled={localRunning || !localFiles.length}>
            {localRunning ? 'Uploading…' : localFiles.length > 1 ? `Upload ${localFiles.length} files` : 'Upload'}
          </button>
        </form>

        {localQueue.length > 0 && (
          <div className="upload-queue">
            {localQueue.map((item) => (
              <div className="upload-item" key={item.id}>
                <div className="upload-item-head">
                  <span className="upload-item-name">{item.name}</span>
                  <StatusPill status={item.status} />
                </div>
                {item.status === 'uploading' && <ProgressBar pct={item.pct} />}
                <div className="upload-item-meta">
                  {item.status === 'uploading' && (
                    <>
                      <span>{item.pct}%</span>
                      <span>
                        {formatBytes(item.loaded)} / {formatBytes(item.total)}
                      </span>
                      {formatEta(item.eta) && <span>{formatEta(item.eta)}</span>}
                    </>
                  )}
                  {item.status !== 'uploading' && item.message && <span>{item.message}</span>}
                </div>
              </div>
            ))}
            <button type="button" className="btn" onClick={clearLocalQueue}>
              Clear finished
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}
