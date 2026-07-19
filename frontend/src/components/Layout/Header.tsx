/**
 * Header Component for Staff Scheduler Layout
 *
 * Provides the top navigation bar with sidebar toggle, branding,
 * and user actions for the application layout.
 *
 * Features:
 * - Sidebar toggle button with hamburger icon
 * - Application branding and title
 * - User profile and logout functionality
 * - Responsive design with Bootstrap classes
 * - Bootstrap Icons integration
 * - Notification bell backed by /api/notifications (unread badge + recent list)
 *
 * @author Luca Ostinelli
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ThemeToggle from '../ThemeToggle';
import * as notificationService from '../../services/notificationService';
import type { AppNotification } from '../../services/notificationService';

/**
 * Props interface for Header component
 */
interface HeaderProps {
  /** Callback function to toggle sidebar visibility */
  onToggleSidebar: () => void;
}

// Notifications are best-effort chrome, not a live feed: a plain interval
// keeps this simple and avoids depending on the SSE stream (F18) from a
// component that must never block or error the rest of the layout.
const POLL_INTERVAL_MS = 30_000;
const RECENT_LIMIT = 5;

/**
 * Header component providing top navigation and controls
 * @param onToggleSidebar - Function to toggle sidebar collapsed state
 * @returns JSX element containing the header navigation
 */
const Header: React.FC<HeaderProps> = ({ onToggleSidebar }) => {
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);
  const [recent, setRecent] = useState<AppNotification[]>([]);
  const mountedRef = useRef(true);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [countRes, listRes] = await Promise.all([
        notificationService.getUnreadCount(),
        notificationService.listNotifications({ limit: RECENT_LIMIT }),
      ]);
      if (!mountedRef.current) return;
      if (countRes.success && countRes.data) setUnreadCount(countRes.data.count);
      if (listRes.success && listRes.data) setRecent(listRes.data);
    } catch {
      // Swallow: the notifications module may be disabled, or the request
      // may simply fail — the bell degrades to its empty state either way.
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [refresh]);

  const handleSelect = async (notification: AppNotification): Promise<void> => {
    if (!notification.isRead) {
      try {
        await notificationService.markNotificationRead(notification.id);
        setUnreadCount((c) => Math.max(0, c - 1));
        setRecent((list) =>
          list.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n))
        );
      } catch {
        // Swallow: the read-state update is best-effort UI feedback.
      }
    }
    if (notification.link) navigate(notification.link);
  };

  const handleMarkAllRead = async (): Promise<void> => {
    try {
      await notificationService.markAllNotificationsRead();
      setUnreadCount(0);
      setRecent((list) => list.map((n) => ({ ...n, isRead: true })));
    } catch {
      // Swallow: best-effort UI feedback, matches handleSelect above.
    }
  };

  return (
    <div className="header">
      <button
        className="btn btn-link text-body p-0 me-3 text-decoration-none"
        onClick={onToggleSidebar}
        aria-label="Toggle sidebar"
        style={{ fontSize: '1.25rem' }}
      >
        <i className="bi bi-list"></i>
      </button>

      <h5 className="mb-0 text-body">Staff Scheduler</h5>

      <div className="ms-auto d-flex align-items-center gap-2">
        <ThemeToggle />
        <div className="dropdown">
          <button
            className="btn btn-link text-body p-0 text-decoration-none position-relative"
            type="button"
            data-bs-toggle="dropdown"
            aria-expanded="false"
            aria-label={
              unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'
            }
          >
            <i className="bi bi-bell" style={{ fontSize: '1.25rem' }}></i>
            {unreadCount > 0 && (
              <span
                className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger"
                style={{ fontSize: '0.6rem' }}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
                <span className="visually-hidden"> unread notifications</span>
              </span>
            )}
          </button>
          <ul className="dropdown-menu dropdown-menu-end" style={{ minWidth: '20rem' }}>
            <li className="d-flex align-items-center justify-content-between px-2">
              <h6 className="dropdown-header mb-0 px-0">Notifications</h6>
              {unreadCount > 0 && (
                <button
                  className="btn btn-link btn-sm text-decoration-none p-0"
                  type="button"
                  onClick={handleMarkAllRead}
                >
                  Mark all read
                </button>
              )}
            </li>
            {recent.length === 0 && (
              <li><span className="dropdown-item-text text-muted">No new notifications</span></li>
            )}
            {recent.map((n) => (
              <li key={n.id}>
                <button
                  className="dropdown-item"
                  type="button"
                  onClick={() => handleSelect(n)}
                >
                  <div className={n.isRead ? 'text-muted' : 'fw-semibold'}>{n.title}</div>
                  {n.body && <div className="small text-muted text-truncate">{n.body}</div>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Header;
