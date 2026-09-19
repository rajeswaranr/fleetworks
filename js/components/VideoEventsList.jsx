// VideoEventsList.jsx - Display dashcam events in a scrollable timeline
// Shows all video alerts with filtering, search, and quick actions

import React, { useState, useEffect } from 'react';
import { supabase } from '../db.js';

export function VideoEventsList({ vehicle_id, onSelectEvent }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('new'); // 'new', 'reviewed', 'all'
  const [sortBy, setSortBy] = useState('recent'); // 'recent', 'severity'

  useEffect(() => {
    loadEvents();

    // Subscribe to new events
    const subscription = supabase
      .channel(`video-events:${vehicle_id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'video_events',
          filter: `vehicle_id=eq.${vehicle_id}`,
        },
        (payload) => {
          setEvents((prev) => [payload.new, ...prev]);
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [vehicle_id]);

  const loadEvents = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('video_events_with_telemetry')
        .select('*')
        .eq('vehicle_id', vehicle_id);

      if (filter !== 'all') {
        query = query.eq('status', filter);
      }

      query = query.order('timestamp', { ascending: false });

      const { data, error } = await query;

      if (error) throw error;
      setEvents(data || []);
    } catch (error) {
      console.error('Error loading video events:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (eventId, newStatus) => {
    try {
      await supabase
        .from('video_events')
        .update({ status: newStatus, reviewed_at: new Date().toISOString() })
        .eq('id', eventId);

      // Update local state
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId ? { ...e, status: newStatus, reviewed_at: new Date().toISOString() } : e
        )
      );
    } catch (error) {
      console.error('Error updating event status:', error);
    }
  };

  const severityColors = {
    info: '#3b82f6',
    warning: '#f59e0b',
    critical: '#ef4444',
  };

  const filteredAndSorted = [...events].sort((a, b) => {
    if (sortBy === 'severity') {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      return (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2);
    }
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  if (loading) {
    return (
      <div className="video-events-list">
        <div className="loading">Loading video events...</div>
      </div>
    );
  }

  return (
    <div className="video-events-list">
      {/* Header with filters */}
      <div className="events-header">
        <h3>Video Events</h3>
        <div className="filter-controls">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="new">New (Unreviewed)</option>
            <option value="reviewed">Reviewed</option>
            <option value="cleared">Cleared</option>
            <option value="flagged">Flagged</option>
            <option value="all">All Events</option>
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="recent">Most Recent</option>
            <option value="severity">By Severity</option>
          </select>
        </div>
      </div>

      {/* Events count */}
      <div className="events-count">
        {filteredAndSorted.length} {filter === 'new' ? 'unreviewed' : 'total'} event{filteredAndSorted.length !== 1 ? 's' : ''}
      </div>

      {/* Events list */}
      {filteredAndSorted.length === 0 ? (
        <div className="empty-state">
          <p>No {filter === 'new' ? 'unreviewed' : ''} video events</p>
        </div>
      ) : (
        <div className="events-timeline">
          {filteredAndSorted.map((event) => (
            <div key={event.id} className="event-card" data-status={event.status}>
              {/* Severity bar */}
              <div className="severity-indicator" style={{ background: severityColors[event.severity] }} />

              {/* Event content */}
              <div className="event-content" onClick={() => onSelectEvent(event)}>
                <div className="event-header">
                  <h4 className="event-type">{event.event_type}</h4>
                  <span className="event-time">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>

                <div className="event-meta">
                  <span className="badge" style={{ background: severityColors[event.severity] }}>
                    {event.severity?.toUpperCase() || 'INFO'}
                  </span>
                  {event.status && event.status !== 'new' && (
                    <span className="badge" style={{ background: 'var(--ai-line)' }}>
                      {event.status.toUpperCase()}
                    </span>
                  )}
                </div>

                <div className="event-details-mini">
                  <div className="detail">
                    <span className="label">Speed:</span>
                    <span className="value">{event.speed_kmh || '—'} km/h</span>
                  </div>
                  <div className="detail">
                    <span className="label">Severity Score:</span>
                    <div className="mini-bar">
                      <div className="mini-fill" style={{ width: `${event.harsh_score || 0}%` }} />
                    </div>
                  </div>
                  <div className="detail">
                    <span className="label">AI Confidence:</span>
                    <span className="value">{event.confidence_pct || '—'}%</span>
                  </div>
                </div>

                {/* Video thumbnail or status */}
                {event.s3_url ? (
                  <div className="has-video">
                    📹 Video available ({event.duration_sec || 0}s)
                  </div>
                ) : (
                  <div className="no-video">⚠️ No video clip</div>
                )}
              </div>

              {/* Actions */}
              <div className="event-actions">
                {event.status === 'new' && (
                  <>
                    <button
                      className="action-btn review"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStatusChange(event.id, 'reviewed');
                      }}
                      title="Mark as reviewed"
                    >
                      ✓
                    </button>
                    <button
                      className="action-btn flag"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStatusChange(event.id, 'flagged');
                      }}
                      title="Flag for follow-up"
                    >
                      🚩
                    </button>
                  </>
                )}
                {event.status === 'reviewed' && (
                  <button
                    className="action-btn clear"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStatusChange(event.id, 'cleared');
                    }}
                    title="Clear"
                  >
                    ✓✓
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        .video-events-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 16px;
          background: var(--ai-surface);
          border: 1px solid var(--ai-line);
          border-radius: 12px;
          max-height: 600px;
          overflow-y: auto;
        }

        .events-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--ai-line);
        }

        .events-header h3 {
          margin: 0;
          font-size: 1.1rem;
          color: var(--ai-text);
        }

        .filter-controls {
          display: flex;
          gap: 8px;
        }

        .filter-controls select {
          padding: 6px 10px;
          border: 1px solid var(--ai-line);
          background: var(--ai-surface);
          color: var(--ai-text);
          border-radius: 6px;
          font-size: 0.85rem;
          cursor: pointer;
        }

        .events-count {
          font-size: 0.85rem;
          color: var(--ai-muted);
        }

        .empty-state {
          text-align: center;
          padding: 40px 20px;
          color: var(--ai-muted);
        }

        .events-timeline {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .event-card {
          display: flex;
          gap: 12px;
          padding: 12px;
          background: var(--ai-surface);
          border: 1px solid var(--ai-line);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .event-card:hover {
          background: rgba(255, 255, 255, 0.05);
          border-color: var(--ai-gradient);
        }

        .event-card[data-status='reviewed'] {
          opacity: 0.7;
        }

        .event-card[data-status='cleared'] {
          opacity: 0.5;
        }

        .severity-indicator {
          width: 3px;
          border-radius: 2px;
          flex-shrink: 0;
        }

        .event-content {
          flex: 1;
          min-width: 0;
        }

        .event-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .event-type {
          margin: 0;
          font-size: 0.95rem;
          font-weight: 600;
          color: var(--ai-text);
          text-transform: capitalize;
        }

        .event-time {
          font-size: 0.8rem;
          color: var(--ai-muted);
        }

        .event-meta {
          display: flex;
          gap: 6px;
          margin-bottom: 8px;
        }

        .badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.7rem;
          font-weight: 600;
          color: white;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .event-details-mini {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          margin-bottom: 8px;
          font-size: 0.8rem;
        }

        .detail {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .detail .label {
          color: var(--ai-muted);
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .detail .value {
          color: var(--ai-text);
          font-weight: 600;
        }

        .mini-bar {
          width: 100%;
          height: 4px;
          background: var(--ai-line);
          border-radius: 2px;
          overflow: hidden;
        }

        .mini-fill {
          height: 100%;
          background: var(--ai-gradient);
        }

        .has-video {
          font-size: 0.8rem;
          color: #4ade80;
          padding: 4px 0;
        }

        .no-video {
          font-size: 0.8rem;
          color: var(--ai-muted);
          padding: 4px 0;
        }

        .event-actions {
          display: flex;
          gap: 6px;
          align-items: center;
        }

        .action-btn {
          width: 32px;
          height: 32px;
          border: 1px solid var(--ai-line);
          background: var(--ai-surface);
          border-radius: 6px;
          cursor: pointer;
          font-size: 1rem;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .action-btn:hover {
          background: var(--ai-line);
        }

        .action-btn.review:hover {
          background: rgba(74, 222, 128, 0.2);
          border-color: #4ade80;
        }

        .action-btn.flag:hover {
          background: rgba(239, 68, 68, 0.2);
          border-color: #ef4444;
        }

        .action-btn.clear:hover {
          background: rgba(100, 200, 255, 0.2);
          border-color: #3b82f6;
        }

        .loading {
          text-align: center;
          padding: 40px 20px;
          color: var(--ai-muted);
        }

        @media (max-width: 768px) {
          .event-details-mini {
            grid-template-columns: 1fr;
          }

          .events-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 10px;
          }

          .filter-controls {
            width: 100%;
          }

          .filter-controls select {
            flex: 1;
          }
        }
      `}</style>
    </div>
  );
}

export default VideoEventsList;
