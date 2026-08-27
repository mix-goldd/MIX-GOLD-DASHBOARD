import { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../../components/Layout';
import { getSessionFromReq } from '../../lib/auth';

export async function getServerSideProps({ req }) {
  const session = getSessionFromReq(req);
  if (!session) return { redirect: { destination: '/login', permanent: false } };
  return { props: { session } };
}

const STARTER_HINTS = [
  'اعرض الفيديوهات',
  'ابحث عن One Piece',
  'جهز نشر الحلقة 1 من One Piece',
  'مساعدة',
];

const TRAINING_ACTIONS = {
  list: 'اعرض مكتبة الفيديوهات',
  search: 'ابحث في مكتبة الفيديوهات',
  'prepare-draft': 'جهّز مسودة محلية من فيديو',
};

const EMPTY_TRAINING_FORM = { phrase: '', action: 'search', query: '', testCommand: '' };
const TRAINING_PAGE_SIZE = 25;
const EMPTY_PROGRESS = { target: 1000, confirmed: 0, pending: 0, builtIn: 0, actionCoverage: 0, actionTarget: 3, percent: 0, level: 'بداية', goalReached: false };

function ResultList({ results }) {
  if (!Array.isArray(results) || !results.length) return null;
  return (
    <ul className="ai-local-results" aria-label="نتائج مكتبة الفيديوهات">
      {results.map((item, index) => (
        <li key={`${item.file_code || item.title}-${index}`}>
          <strong>{item.title}</strong>
          <span>{item.duration ? `المدة: ${item.duration}` : 'المدة غير متاحة'}</span>
        </li>
      ))}
    </ul>
  );
}

export default function LocalCommandAssistant({ session }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(null);
  const [pendingChange, setPendingChange] = useState(null);
  const [training, setTraining] = useState([]);
  const [pendingTraining, setPendingTraining] = useState([]);
  const [builtInTraining, setBuiltInTraining] = useState([]);
  const [trainingProgress, setTrainingProgress] = useState(EMPTY_PROGRESS);
  const [trainingForm, setTrainingForm] = useState(EMPTY_TRAINING_FORM);
  const [pendingDecisions, setPendingDecisions] = useState({});
  const [editingTrainingId, setEditingTrainingId] = useState(null);
  const [trainingLoading, setTrainingLoading] = useState(true);
  const [trainingSaving, setTrainingSaving] = useState(false);
  const [trainingError, setTrainingError] = useState(null);
  const [trainingSearch, setTrainingSearch] = useState('');
  const [trainingPage, setTrainingPage] = useState(1);
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, sending, pendingChange]);

  function applyTrainingPayload(nextTraining) {
    setTraining(Array.isArray(nextTraining?.examples) ? nextTraining.examples : []);
    setPendingTraining(Array.isArray(nextTraining?.pending) ? nextTraining.pending : []);
    setBuiltInTraining(Array.isArray(nextTraining?.builtInExamples) ? nextTraining.builtInExamples : []);
    setTrainingProgress({ ...EMPTY_PROGRESS, ...(nextTraining?.progress || {}) });
  }

  async function loadTraining({ showLoading = true } = {}) {
    if (showLoading) setTrainingLoading(true);
    try {
      const res = await fetch('/api/ai/training');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'تعذر تحميل عبارات التدريب المحلية.');
      applyTrainingPayload(data.training);
    } catch (err) {
      setTrainingError(err.message);
    } finally {
      if (showLoading) setTrainingLoading(false);
    }
  }

  useEffect(() => {
    loadTraining();
  }, []);

  async function send(text) {
    const command = text.trim();
    if (!command || sending) return;
    setError(null);
    setInput('');
    setMessages((current) => [...current, { role: 'user', text: command }]);
    setSending(true);
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'تعذر تنفيذ الأمر المحلي.');

      if (data.action === 'prepare-draft' && data.draft) {
        setDraft(data.draft);
        setPendingChange(null);
      }
      if (data.action === 'rename-draft' || data.action === 'delete-draft') {
        setPendingChange(data);
      }
      setMessages((current) => [...current, {
        role: 'model',
        text: data.text || 'تم تنفيذ الأمر.',
        results: data.results || [],
        learned: Boolean(data.learned),
        builtIn: Boolean(data.builtIn),
      }]);
      if (data.suggestionRecorded) loadTraining({ showLoading: false });
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    send(input);
  }

  function updateTrainingField(field, value) {
    setTrainingForm((current) => ({ ...current, [field]: value }));
  }

  function resetTrainingForm() {
    setTrainingForm(EMPTY_TRAINING_FORM);
    setEditingTrainingId(null);
  }

  async function saveTraining(event) {
    event.preventDefault();
    if (trainingSaving) return;
    setTrainingError(null);
    setTrainingSaving(true);
    try {
      const payload = {
        phrase: trainingForm.phrase,
        action: trainingForm.action,
        query: trainingForm.query,
      };
      const res = await fetch('/api/ai/training', {
        method: editingTrainingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingTrainingId ? { ...payload, id: editingTrainingId } : payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'تعذر حفظ عبارة التدريب.');
      applyTrainingPayload(data.training);
      resetTrainingForm();
    } catch (err) {
      setTrainingError(err.message);
    } finally {
      setTrainingSaving(false);
    }
  }

  function beginTrainingEdit(example) {
    setTrainingError(null);
    setEditingTrainingId(example.id);
    setTrainingForm({
      phrase: example.phrase,
      action: example.action,
      query: example.query || '',
      testCommand: '',
    });
  }

  async function removeTrainingExample(example) {
    if (!window.confirm(`حذف العبارة «${example.phrase}»؟ لن يؤثر هذا في الفيديوهات أو المنشورات.`)) return;
    setTrainingError(null);
    try {
      const res = await fetch(`/api/ai/training?id=${encodeURIComponent(example.id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'تعذر حذف عبارة التدريب.');
      applyTrainingPayload(data.training);
      if (editingTrainingId === example.id) resetTrainingForm();
    } catch (err) {
      setTrainingError(err.message);
    }
  }

  function testTrainingExample(event) {
    event.preventDefault();
    if (!trainingForm.testCommand.trim()) {
      setTrainingError('اكتب أمرًا تجريبيًا أولًا.');
      return;
    }
    send(trainingForm.testCommand);
  }

  function getPendingDecision(candidate) {
    return pendingDecisions[candidate.id] || { phrase: candidate.phrase, action: 'list', query: '' };
  }

  function updatePendingDecision(candidate, field, value) {
    setPendingDecisions((current) => ({
      ...current,
      [candidate.id]: { phrase: candidate.phrase, action: 'list', query: '', ...(current[candidate.id] || {}), [field]: value },
    }));
  }

  async function approvePendingTraining(candidate) {
    const decision = getPendingDecision(candidate);
    setTrainingError(null);
    setTrainingSaving(true);
    try {
      const res = await fetch('/api/ai/training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'approve-pending', id: candidate.id, ...decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'تعذر اعتماد العبارة المقترحة.');
      applyTrainingPayload(data.training);
      setPendingDecisions((current) => {
        const next = { ...current };
        delete next[candidate.id];
        return next;
      });
    } catch (err) {
      setTrainingError(err.message);
    } finally {
      setTrainingSaving(false);
    }
  }

  async function dismissPendingTraining(candidate) {
    if (!window.confirm(`إخفاء العبارة «${candidate.phrase}» من قائمة المراجعة؟ لن يؤثر ذلك في الفيديوهات أو المنشورات.`)) return;
    setTrainingError(null);
    try {
      const res = await fetch(`/api/ai/training?id=${encodeURIComponent(candidate.id)}&operation=dismiss-pending`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'تعذر إخفاء العبارة المقترحة.');
      applyTrainingPayload(data.training);
    } catch (err) {
      setTrainingError(err.message);
    }
  }

  const filteredTraining = useMemo(() => {
    const needle = trainingSearch.trim().toLowerCase();
    if (!needle) return training;
    return training.filter((example) => [example.phrase, example.query, TRAINING_ACTIONS[example.action]]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle)));
  }, [training, trainingSearch]);
  const visibleTrainingPage = Math.max(1, Math.ceil(filteredTraining.length / TRAINING_PAGE_SIZE));
  const activeTrainingPage = Math.min(trainingPage, visibleTrainingPage);
  const visibleTraining = filteredTraining.slice((activeTrainingPage - 1) * TRAINING_PAGE_SIZE, activeTrainingPage * TRAINING_PAGE_SIZE);

  function confirmPendingChange() {
    if (!pendingChange) return;
    if (pendingChange.action === 'rename-draft' && pendingChange.draft) {
      setDraft(pendingChange.draft);
      setMessages((current) => [...current, { role: 'model', text: `تم تغيير عنوان المسودة إلى «${pendingChange.draft.title}».` }]);
    }
    if (pendingChange.action === 'delete-draft') {
      setDraft(null);
      setMessages((current) => [...current, { role: 'model', text: 'تم حذف المسودة المحلية فقط. لم يُحذف أي فيديو أو منشور.' }]);
    }
    setPendingChange(null);
  }

  function openDraftInContentForm() {
    if (!draft?.title) return;
    window.sessionStorage.setItem('mix_gold_local_post_draft_v1', JSON.stringify(draft));
    window.location.assign('/dashboard/content');
  }

  return (
    <Layout title="مساعد الأوامر المحلي" session={session}>
      <div dir="rtl" className="ai-chat-panel">
        <section className="ai-memory-card" aria-labelledby="local-command-title">
          <div className="ai-memory-head">
            <div>
              <h2 id="local-command-title"><i className="fas fa-terminal" /> مساعد الأوامر المحلي</h2>
              <p>يبحث في نسخة المكتبة المحفوظة ويجهّز المسودات، من دون Gemini أو مفاتيح أو طلبات Vidmoly جديدة.</p>
            </div>
            <span className="ai-memory-count">مجاني</span>
          </div>
          <div className="ai-command-guide">
            <span><b>بحث:</b> ابحث عن One Piece</span>
            <span><b>مسودة:</b> جهز نشر الحلقة 1 من One Piece</span>
            <span><b>تعديل:</b> غير عنوان المسودة إلى ...</span>
            <span><b>حذف:</b> احذف المسودة</span>
          </div>
        </section>

        <section className="ai-training-card" aria-labelledby="local-training-title">
          <div className="ai-memory-head">
            <div>
              <h2 id="local-training-title"><i className="fas fa-book-open" /> علّم المنفذ عبارة</h2>
              <p>العبارات المؤكدة تظهر هنا في حسابك. الحزمة الجاهزة تعمل محليًا، وأي عبارة لا تُفهم تُضاف للمراجعة فقط حتى تحدد معناها.</p>
            </div>
            <span className="ai-memory-count">{trainingProgress.confirmed}/{trainingProgress.target}</span>
          </div>

          <div className="ai-training-progress" aria-label="مستوى التدريب المحلي">
            <div>
              <span>المستوى: <b>{trainingProgress.level}</b></span>
              <strong>{trainingProgress.percent}%</strong>
            </div>
            <div className="ai-training-progress-track" aria-hidden="true"><span style={{ width: `${trainingProgress.percent}%` }} /></div>
            <p>{trainingProgress.confirmed} عبارة مؤكدة من هدف {trainingProgress.target}، وتغطية {trainingProgress.actionCoverage}/{trainingProgress.actionTarget} إجراءات آمنة.</p>
          </div>

          <details className="ai-training-pack">
            <summary>حزمة الاختصارات الجاهزة ({builtInTraining.length})</summary>
            <p>تعمل فورًا ولا تُحتسب ضمن هدف عباراتك المؤكدة. يمكنك رؤية كل عبارة هنا قبل استخدامها.</p>
            <ul>
              {builtInTraining.map((example) => <li key={example.id}><b>{example.phrase}</b><span>{TRAINING_ACTIONS[example.action]}</span></li>)}
            </ul>
          </details>

          <form className="ai-training-form" onSubmit={saveTraining}>
            <label>
              العبارة التي سأكتبها
              <input
                type="text"
                value={trainingForm.phrase}
                onChange={(event) => updateTrainingField('phrase', event.target.value)}
                placeholder="مثال: لقّي {title}"
                maxLength="160"
                disabled={trainingSaving}
              />
            </label>
            <label>
              المقصود منها
              <select value={trainingForm.action} onChange={(event) => updateTrainingField('action', event.target.value)} disabled={trainingSaving}>
                {Object.entries(TRAINING_ACTIONS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            {trainingForm.action !== 'list' && !trainingForm.phrase.toLowerCase().includes('{title}') && (
              <label>
                عنوان ثابت للتنفيذ
                <input
                  type="text"
                  value={trainingForm.query}
                  onChange={(event) => updateTrainingField('query', event.target.value)}
                  placeholder="مثال: الحلقة 1 من One Piece"
                  maxLength="220"
                  disabled={trainingSaving}
                />
              </label>
            )}
            <div className="ai-training-actions">
              <button type="submit" className="btn btn-ai" disabled={trainingSaving}>{editingTrainingId ? 'حفظ التعديل' : 'حفظ العبارة'}</button>
              {editingTrainingId && <button type="button" className="btn" onClick={resetTrainingForm} disabled={trainingSaving}>إلغاء</button>}
            </div>
          </form>

          <p className="ai-training-note">للعناوين المتغيرة اكتب <b>{'{title}'}</b> مرة واحدة، مثل: <b>لقّي {'{title}'}</b>. أما «اعرض مكتبتي» فيكفي اختيار عرض المكتبة.</p>

          <form className="ai-training-test" onSubmit={testTrainingExample}>
            <input
              type="text"
              value={trainingForm.testCommand}
              onChange={(event) => updateTrainingField('testCommand', event.target.value)}
              placeholder="جرّب عبارة محفوظة، مثال: لقّي One Piece"
              maxLength="300"
              disabled={sending}
            />
            <button type="submit" className="btn" disabled={sending}>جرّب</button>
          </form>

          {pendingTraining.length > 0 && (
            <section className="ai-training-pending" aria-labelledby="pending-training-title">
              <div className="ai-training-subhead">
                <div>
                  <h3 id="pending-training-title">عبارات للمراجعة ({pendingTraining.length})</h3>
                  <p>هذه عبارات لم تُفهم؛ لن تنفذ شيئًا حتى تعتمد معناها بنفسك.</p>
                </div>
              </div>
              <ul>
                {pendingTraining.map((candidate) => {
                  const decision = getPendingDecision(candidate);
                  const needsQuery = decision.action !== 'list' && !decision.phrase.toLowerCase().includes('{title}');
                  return (
                    <li key={candidate.id}>
                      <div className="ai-training-pending-copy">
                        <strong>{candidate.phrase}</strong>
                        <span>ظهرت {candidate.seenCount} {candidate.seenCount === 1 ? 'مرة' : 'مرات'}</span>
                      </div>
                      <div className="ai-training-pending-controls">
                        <input value={decision.phrase} maxLength="160" onChange={(event) => updatePendingDecision(candidate, 'phrase', event.target.value)} aria-label={`عبارة ${candidate.phrase}`} disabled={trainingSaving} />
                        <select value={decision.action} onChange={(event) => updatePendingDecision(candidate, 'action', event.target.value)} aria-label={`معنى ${candidate.phrase}`} disabled={trainingSaving}>
                          {Object.entries(TRAINING_ACTIONS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                        </select>
                        {needsQuery && <input value={decision.query} maxLength="220" onChange={(event) => updatePendingDecision(candidate, 'query', event.target.value)} placeholder="عنوان ثابت للتنفيذ" aria-label={`عنوان ${candidate.phrase}`} disabled={trainingSaving} />}
                        <div className="ai-training-actions">
                          <button type="button" className="btn btn-ai" onClick={() => approvePendingTraining(candidate)} disabled={trainingSaving}>اعتماد</button>
                          <button type="button" className="btn" onClick={() => dismissPendingTraining(candidate)} disabled={trainingSaving}>إخفاء</button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {trainingError && <div className="ai-memory-error" role="alert">{trainingError}</div>}
          {trainingLoading ? <p className="ai-memory-empty">جارٍ تحميل العبارات المحفوظة...</p> : (
            training.length ? (
              <div className="ai-training-library">
                <div className="ai-training-library-head">
                  <label>
                    ابحث في عباراتك المؤكدة
                    <input value={trainingSearch} maxLength="160" onChange={(event) => { setTrainingSearch(event.target.value); setTrainingPage(1); }} placeholder="ابحث بالعبارة أو الإجراء" />
                  </label>
                  <span>{filteredTraining.length} عبارة</span>
                </div>
                {visibleTraining.length ? <ul className="ai-training-list" aria-label="عبارات التدريب المحفوظة">
                  {visibleTraining.map((example) => (
                    <li key={example.id}>
                      <div>
                        <strong>{example.phrase}</strong>
                        <span>{TRAINING_ACTIONS[example.action]}{example.query ? `: ${example.query}` : ''}</span>
                      </div>
                      <div className="ai-memory-actions">
                        <button type="button" onClick={() => beginTrainingEdit(example)} aria-label={`تعديل ${example.phrase}`} title="تعديل"><i className="fas fa-pen" /></button>
                        <button type="button" onClick={() => removeTrainingExample(example)} aria-label={`حذف ${example.phrase}`} title="حذف"><i className="fas fa-trash" /></button>
                      </div>
                    </li>
                  ))}
                </ul> : <p className="ai-memory-empty">لا توجد نتيجة مطابقة للبحث.</p>}
                {filteredTraining.length > TRAINING_PAGE_SIZE && <div className="ai-training-pagination" aria-label="صفحات عبارات التدريب">
                  <button type="button" className="btn" onClick={() => setTrainingPage((current) => Math.max(1, current - 1))} disabled={activeTrainingPage === 1}>السابق</button>
                  <span>صفحة {activeTrainingPage} من {visibleTrainingPage}</span>
                  <button type="button" className="btn" onClick={() => setTrainingPage((current) => Math.min(visibleTrainingPage, current + 1))} disabled={activeTrainingPage === visibleTrainingPage}>التالي</button>
                </div>}
              </div>
            ) : <p className="ai-memory-empty">لا توجد عبارات محفوظة بعد. أضف اختصارك الأول أعلاه.</p>
          )}
        </section>

        {draft && (
          <section className="ai-local-draft" aria-label="المسودة المحلية الحالية">
            <div>
              <strong>مسودة محلية جاهزة</strong>
              <p>{draft.title}</p>
            </div>
            <button type="button" className="btn btn-ai" onClick={openDraftInContentForm}>
              افتحها في نموذج النشر
            </button>
          </section>
        )}

        {pendingChange && (
          <section className="ai-local-confirm" role="alert">
            <p>{pendingChange.text}</p>
            <div>
              <button type="button" className="btn btn-ai" onClick={confirmPendingChange}>تأكيد</button>
              <button type="button" className="btn" onClick={() => setPendingChange(null)}>إلغاء</button>
            </div>
          </section>
        )}

        <div className="ai-chat-list" ref={listRef}>
          {messages.length === 0 && (
            <div className="ai-chat-empty">
              <p>اكتب أمرًا واضحًا لتنفيذه داخل اللوحة. لا ينشر أو يحذف أي محتوى تلقائيًا.</p>
              <div className="ai-chat-hints">
                {STARTER_HINTS.map((hint) => (
                  <button type="button" key={hint} className="ai-chat-hint" onClick={() => send(hint)}>{hint}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message, index) => (
            <div key={index} className={`ai-chat-msg ai-chat-msg-${message.role}`}>
              <div className="ai-chat-bubble">{message.text}</div>
              {message.learned && <span className="ai-learned-label">فُهمت من عبارة علّمتها</span>}
              <ResultList results={message.results} />
            </div>
          ))}
          {sending && <div className="ai-chat-msg ai-chat-msg-model"><div className="ai-chat-bubble ai-chat-bubble-loading">جارٍ تنفيذ الأمر المحلي...</div></div>}
        </div>

        {error && <div className="banner banner-error">{error}</div>}
        <form className="ai-chat-input-row" onSubmit={handleSubmit}>
          <input type="text" value={input} onChange={(event) => setInput(event.target.value)} placeholder="مثال: جهز نشر الحلقة 1 من One Piece" disabled={sending} />
          <button type="submit" className="btn btn-ai" disabled={sending || !input.trim()} aria-label="تنفيذ الأمر"><i className="fas fa-paper-plane" /></button>
        </form>
      </div>
    </Layout>
  );
}
