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
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, sending]);

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
