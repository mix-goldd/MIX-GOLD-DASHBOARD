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
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, sending, pendingChange]);

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
