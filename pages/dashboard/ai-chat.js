import { useEffect, useRef, useState } from 'react';
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
  const [trainingForm, setTrainingForm] = useState(EMPTY_TRAINING_FORM);
  const [editingTrainingId, setEditingTrainingId] = useState(null);
  const [trainingLoading, setTrainingLoading] = useState(true);
  const [trainingSaving, setTrainingSaving] = useState(false);
  const [trainingError, setTrainingError] = useState(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, sending, pendingChange]);

  useEffect(() => {
    let active = true;
    async function loadTraining() {
      try {
        const res = await fetch('/api/ai/training');
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'تعذر تحميل عبارات التدريب المحلية.');
        if (active) setTraining(data.training?.examples || []);
      } catch (err) {
        if (active) setTrainingError(err.message);
      } finally {
        if (active) setTrainingLoading(false);
      }
    }
    loadTraining();
    return () => { active = false; };
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
      }]);
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
      setTraining(data.training?.examples || []);
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
      setTraining(data.training?.examples || []);
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
              <p>احفظ اختصارًا يطابق حرفيًا بعد توحيد المسافات والرموز. هذا ليس نموذج ذكاء اصطناعي ولا يمنح صلاحيات جديدة.</p>
            </div>
            <span className="ai-memory-count">{training.length}/60</span>
          </div>

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

          {trainingError && <div className="ai-memory-error" role="alert">{trainingError}</div>}
          {trainingLoading ? <p className="ai-memory-empty">جارٍ تحميل العبارات المحفوظة...</p> : (
            training.length ? (
              <ul className="ai-training-list" aria-label="عبارات التدريب المحفوظة">
                {training.map((example) => (
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
              </ul>
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
