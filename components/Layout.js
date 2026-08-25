import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';

function formatNotifTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const wrapRef = useRef(null);

  async function loadNotifications() {
    try {
      const res = await fetch('/api/notifications');
      const data = await res.json();
      if (res.ok) {
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (err) {
      // Notifications are a nice-to-have — a failed poll shouldn't be noisy.
    }
  }

  useEffect(() => {
    loadNotifications();
    // Polled fairly aggressively so a teammate deleting a file shows up
    // for everyone else within a few seconds without needing to reload.
    const interval = setInterval(loadNotifications, 8000);

    // Any tab that just deleted a file fires this immediately, so that
    // tab's own bell updates instantly instead of waiting on the poll.
    window.addEventListener('doodops:notify-refresh', loadNotifications);
    // Catch up right away if the tab was backgrounded for a while.
    function handleVisibility() {
      if (document.visibilityState === 'visible') loadNotifications();
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      window.removeEventListener('doodops:notify-refresh', loadNotifications);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function toggleOpen() {
    const opening = !open;
    setOpen(opening);
    if (opening && unreadCount > 0) {
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      try {
        await fetch('/api/notifications', { method: 'PATCH' });
      } catch (err) {
        // Best effort — worst case it re-shows as unread on the next poll.
      }
    }
  }

  async function removeOne(id) {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    try {
      await fetch(`/api/notifications?id=${id}`, { method: 'DELETE' });
    } catch (err) {
      // Best effort — worst case it reappears on the next poll.
    }
  }

  async function removeAll() {
    setNotifications([]);
    setUnreadCount(0);
    try {
      await fetch('/api/notifications', { method: 'DELETE' });
    } catch (err) {
      // Best effort — worst case they reappear on the next poll.
    }
  }

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        type="button"
        className="notif-bell"
        aria-label="Notifications"
        onClick={toggleOpen}
      >
        <i className="fas fa-bell" />
        {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>
      {open && (
        <div className="notif-dropdown">
          <div className="notif-dropdown-head">
            <span>Notifications</span>
            {notifications.length > 0 && (
              <button type="button" className="notif-clear-all" onClick={removeAll}>
                Clear all
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="notif-empty">No notifications yet.</p>
          ) : (
            <div className="notif-list">
              {notifications.map((n) => (
                <div className={`notif-item ${n.is_read ? '' : 'notif-item-unread'}`} key={n.id}>
                  {n.thumb ? (
                    <img src={n.thumb} alt="" className="notif-item-thumb" />
                  ) : (
                    <div className="notif-item-thumb notif-item-thumb-empty">
                      <i className="fas fa-file-video" />
                    </div>
                  )}
                  <div className="notif-item-body">
                    <div className="notif-item-text">
                      <strong>{n.title || n.file_code}</strong> was removed from Vidmoly — deleted or expired.
                    </div>
                    <div className="notif-item-time">{formatNotifTime(n.created_at)}</div>
                  </div>
                  <button
                    type="button"
                    className="notif-item-remove"
                    aria-label="Delete notification"
                    onClick={() => removeOne(n.id)}
                  >
                    <i className="fas fa-times" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Layout({ title, session, children }) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [labels, setLabels] = useState(null);

  useEffect(() => {
    fetch('/api/dashboard-settings')
      .then((res) => res.json())
      .then((data) => setLabels(data.sidebarLabels || null))
      .catch(() => {});
  }, []);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  const label = (key, fallback) => labels?.[key] || fallback;

  const links = [
    { href: '/dashboard', label: label('videos', 'Videos') },
    { href: '/dashboard/upload', label: label('upload', 'Add video') },
    { href: '/dashboard/content', label: label('content', 'إضافة محتوى') },
    { href: '/dashboard/media', label: label('media', 'مكتبة الوسائط') },
    { href: '/dashboard/statistics', label: label('statistics', 'إحصائيات المحتوى') },
    { href: '/dashboard/content-manager', label: label('contentManager', 'مدير المحتوى') },
    { href: '/dashboard/comments', label: label('comments', 'التعليقات') },
    { href: '/dashboard/ai-chat', label: label('aiChat', '✨ مساعد الذكاء الاصطناعي') },
    { href: '/dashboard/settings', label: label('settings', 'الإعدادات') },
  ];
  if (session?.role === 'admin') {
    links.push({ href: '/dashboard/team', label: label('team', 'Team') });
  }

  function closeMobile() {
    setMobileOpen(false);
  }

  return (
    <div className="shell">
      <div
        className={`sidebar-overlay ${mobileOpen ? 'active' : ''}`}
        onClick={closeMobile}
      />
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="brand">
          <span className="tally-dot" />
          DoodOps
        </div>
        <nav>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={closeMobile}
              className={`nav-link ${router.pathname === link.href ? 'active' : ''}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-row">
            <span>{session?.username}</span>
            <span className="role-badge">{session?.role}</span>
          </div>
          <button className="btn btn-full" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="main">
        <div className="mobile-header">
          <button
            className="menu-toggle"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
          >
            ☰
          </button>
          <div className="mobile-header-title">{title}</div>
          <NotificationBell />
        </div>

        <div className="topbar">
          <h1>{title}</h1>
          <NotificationBell />
        </div>
        <div className="page-body">{children}</div>
      </div>
    </div>
  );
}
