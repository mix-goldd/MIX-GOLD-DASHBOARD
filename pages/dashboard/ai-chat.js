import { useEffect, useRef, useState } from 'react';
import Layout from '../../components/Layout';
import { getSessionFromReq } from '../../lib/auth';

export async function getServerSideProps({ req }) {
  const session = getSessionFromReq(req);
  if (!session) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  return { props: { session } };
}

const STARTER_HINTS = [
  'اعرضلي كل الفيديوهات',
  'غيّر عنوان فيديو 720p لـ "الحلقة الأولى"',
  'انشئ مجلد اسمه أنمي 2026',
  'انقل فيديو 1080p لمجلد أنمي 2026',
];

function ActionLog({ action }) {
  const ok = action.result?.success !== false && !action.result?.error;
  return (
    <div className={`ai-action ${ok ? 'ai-action-ok' : 'ai-action-fail'}`}>
      <i className={`fas ${ok ? 'fa-check' : 'fa-xmark'}`} /> {action.name}
      {action.args && Object.keys(action.args).length > 0 ? `(${JSON.stringify(action.args)})` : ''}
    </div>
  );
}

export default function AiChat({ session }) {
  const [messages, setMessages] = useState([]); // { role: 'user'|'model', text, actions? }
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [memory, setMemory] = useState({ rules: [] });
  const [memoryLoading, setMemoryLoading] = useState(true);
  const [memoryError, setMemoryError] = useState(null);
  const [newRule, setNewRule] = useState('');
  const [memorySaving, setMemorySaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, sending]);

  useEffect(() => {
    let active = true;
    fetch('/api/ai/memory')
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'تعذر تحميل ذاكرة المساعد.');
        return data.memory;
      })
      .then((nextMemory) => {
        if (active) setMemory(nextMemory || { rules: [] });
      })
      .catch((err) => active && setMemoryError(err.message))
      .finally(() => active && setMemoryLoading(false));
    return () => {
      active = false;
    };
  }, []);

  async function saveMemory(method, body, id) {
    setMemoryError(null);
    setMemorySaving(true);
    try {
      const url = id ? `/api/ai/memory?id=${encodeURIComponent(id)}` : '/api/ai/memory';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'DELETE' ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'تعذر حفظ الذاكرة.');
      setMemory(data.memory || { rules: [] });
      return true;
    } catch (err) {
      setMemoryError(err.message);
      return false;
    } finally {
      setMemorySaving(false);
    }
  }

  async function addRule(e) {
    e.preventDefault();
    const text = newRule.trim();
    if (!text || memorySaving) return;
    if (await saveMemory('POST', { text })) setNewRule('');
  }

  async function updateRule(e) {
    e.preventDefault();
    const text = editingText.trim();
    if (!editingId || !text || memorySaving) return;
    if (await saveMemory('PATCH', { id: editingId, text })) {
      setEditingId(null);
      setEditingText('');
    }
  }

  async function deleteRule(id) {
    if (memorySaving || !window.confirm('حذف هذه القاعدة من ذاكرة المساعد؟')) return;
    await saveMemory('DELETE', null, id);
  }

  async function send(text) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setError(null);
    const next = [...messages, { role: 'user', text: trimmed }];
    setMessages(next);
    setInput('');
    setSending(true);
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, text: m.text })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'تعذر التواصل مع المساعد.');
      setMessages((prev) => [...prev, { role: 'model', text: data.text, actions: data.actions || [] }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    send(input);
  }

  return (
    <Layout title="مساعد الذكاء الاصطناعي" session={session}>
      <div dir="rtl" className="ai-chat-panel">
        <section className="ai-memory-card" aria-labelledby="ai-memory-title">
          <div className="ai-memory-head">
            <div>
              <h2 id="ai-memory-title"><i className="fas fa-brain" /> ما تعلّمه مساعد MIX</h2>
              <p>أضف قواعدك بنفسك؛ لا تُحفظ المحادثات أو الأسرار تلقائيًا.</p>
            </div>
            <span className="ai-memory-count">{memory.rules?.length || 0}/60 قاعدة</span>
          </div>
          <form className="ai-memory-add" onSubmit={addRule}>
            <input
              type="text"
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              placeholder="مثال: اكتب العناوين بالعربية وبشكل قصير"
              maxLength={500}
              disabled={memorySaving}
              aria-label="قاعدة جديدة للمساعد"
            />
            <button type="submit" className="btn btn-ai" disabled={memorySaving || !newRule.trim()}>احفظ كقاعدة</button>
          </form>
          {memoryError && <div className="ai-memory-error">{memoryError}</div>}
          {memoryLoading ? (
            <p className="ai-memory-empty">جارٍ تحميل قواعدك…</p>
          ) : memory.rules?.length ? (
            <ul className="ai-memory-rules">
              {memory.rules.map((rule) => (
                <li key={rule.id} className="ai-memory-rule">
                  {editingId === rule.id ? (
                    <form className="ai-memory-edit" onSubmit={updateRule}>
                      <input value={editingText} onChange={(e) => setEditingText(e.target.value)} maxLength={500} autoFocus />
                      <button type="submit" disabled={memorySaving || !editingText.trim()} aria-label="حفظ تعديل القاعدة"><i className="fas fa-check" /></button>
                      <button type="button" onClick={() => { setEditingId(null); setEditingText(''); }} disabled={memorySaving} aria-label="إلغاء التعديل"><i className="fas fa-xmark" /></button>
                    </form>
                  ) : (
                    <>
                      <span>{rule.text}</span>
                      <div className="ai-memory-actions">
                        <button type="button" onClick={() => { setEditingId(rule.id); setEditingText(rule.text); }} disabled={memorySaving} aria-label="تعديل القاعدة"><i className="fas fa-pen" /></button>
                        <button type="button" onClick={() => deleteRule(rule.id)} disabled={memorySaving} aria-label="حذف القاعدة"><i className="fas fa-trash" /></button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ai-memory-empty">لا توجد قواعد محفوظة بعد. أضف أول تفضيل ليبدأ المساعد في فهم طريقتك.</p>
          )}
        </section>
        <div className="ai-chat-list" ref={listRef}>
          {messages.length === 0 && (
            <div className="ai-chat-empty">
              <p>اكتب طلبك، والمساعد ينفذه فعليًا (مش بس يقترح) عن طريق أدوات حقيقية على الموقع.</p>
              <div className="ai-chat-hints">
                {STARTER_HINTS.map((hint) => (
                  <button type="button" key={hint} className="ai-chat-hint" onClick={() => send(hint)}>
                    {hint}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`ai-chat-msg ai-chat-msg-${m.role}`}>
              <div className="ai-chat-bubble">{m.text}</div>
              {m.actions && m.actions.length > 0 && (
                <div className="ai-action-log">
                  {m.actions.map((a, j) => (
                    <ActionLog action={a} key={j} />
                  ))}
                </div>
              )}
            </div>
          ))}
          {sending && (
            <div className="ai-chat-msg ai-chat-msg-model">
              <div className="ai-chat-bubble ai-chat-bubble-loading">جارٍ التفكير والتنفيذ...</div>
            </div>
          )}
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        <form className="ai-chat-input-row" onSubmit={handleSubmit}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="اكتب طلبك هنا..."
            disabled={sending}
          />
          <button type="submit" className="btn btn-ai" disabled={sending || !input.trim()}>
            <i className="fas fa-paper-plane" />
          </button>
        </form>
      </div>
    </Layout>
  );
}
