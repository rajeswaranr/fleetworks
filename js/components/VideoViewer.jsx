// VideoViewer.jsx - Dashcam video player with telemetry overlay
// Shows video clips with synchronized speed, GPS, and driver alerts

import React, { useState, useEffect, useRef } from 'react';

export function VideoViewer({ videoEvent, onClose }) {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [showTelemetry, setShowTelemetry] = useState(true);

  if (!videoEvent) return null;

  const handlePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = (e) => {
    setCurrentTime(e.target.currentTime);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Severity badge color
  const severityColor = {
    info: '#3b82f6',
    warning: '#f59e0b',
    critical: '#ef4444',
  }[videoEvent.severity || 'info'];

  const severityLabel = {
    info: 'Info',
    warning: 'Warning',
    critical: 'Critical',
  }[videoEvent.severity || 'info'];

  return (
    <div className="video-viewer-modal">
      {/* Modal backdrop */}
      <div className="modal-backdrop" onClick={onClose} />

      {/* Video player */}
      <div className="video-viewer">
        <div className="video-player-container">
          {/* Header with close button */}
          <div className="video-header">
            <div>
              <h3>{videoEvent.event_type}</h3>
              <span className="severity-badge" style={{ background: severityColor }}>
                {severityLabel}
              </span>
            </div>
            <button className="close-btn" onClick={onClose}>✕</button>
          </div>

          {/* Video player */}
          <div className="video-player">
            <video
              ref={videoRef}
              src={videoEvent.s3_url}
              controls
              onTimeUpdate={handleTimeUpdate}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
            />
          </div>

          {/* Playback controls */}
          <div className="playback-controls">
            <button onClick={handlePlayPause} className="play-btn">
              {isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>
            <div className="time-display">
              {formatTime(currentTime)} / {formatTime(videoEvent.duration_sec || 0)}
            </div>
            <label className="telemetry-toggle">
              <input
                type="checkbox"
                checked={showTelemetry}
                onChange={(e) => setShowTelemetry(e.target.checked)}
              />
              Show telemetry
            </label>
          </div>

          {/* Telemetry overlay */}
          {showTelemetry && (
            <div className="telemetry-panel">
              <div className="telemetry-grid">
                <div className="telemetry-item">
                  <span className="label">Speed</span>
                  <span className="value">{videoEvent.speed_kmh || '—'} km/h</span>
                </div>
                <div className="telemetry-item">
                  <span className="label">GPS Location</span>
                  <span className="value">
                    {videoEvent.latitude?.toFixed(4) || '—'}, {videoEvent.longitude?.toFixed(4) || '—'}
                  </span>
                </div>
                <div className="telemetry-item">
                  <span className="label">RPM</span>
                  <span className="value">{videoEvent.rpm || '—'}</span>
                </div>
                <div className="telemetry-item">
                  <span className="label">Fuel</span>
                  <span className="value">{videoEvent.fuel_pct || '—'}%</span>
                </div>
                <div className="telemetry-item">
                  <span className="label">Harsh Score</span>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${videoEvent.harsh_score || 0}%` }}
                    />
                  </div>
                </div>
                <div className="telemetry-item">
                  <span className="label">AI Confidence</span>
                  <span className="value">{videoEvent.confidence_pct || '—'}%</span>
                </div>
              </div>

              {/* AI detection */}
              {videoEvent.ai_detection && (
                <div className="ai-detection">
                  <h4>AI Detection</h4>
                  <div className="detection-items">
                    {JSON.parse(videoEvent.ai_detection || '[]').map((item, idx) => (
                      <div key={idx} className="detection-item">
                        <span className="type">{item.type}</span>
                        <span className="confidence">{Math.round(item.confidence * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Event details */}
          <div className="event-details">
            <div className="detail-row">
              <span className="label">Timestamp:</span>
              <span>{new Date(videoEvent.timestamp).toLocaleString()}</span>
            </div>
            <div className="detail-row">
              <span className="label">Duration:</span>
              <span>{videoEvent.duration_sec} seconds</span>
            </div>
            {videoEvent.reviewed_at && (
              <div className="detail-row">
                <span className="label">Reviewed:</span>
                <span>{new Date(videoEvent.reviewed_at).toLocaleString()}</span>
              </div>
            )}
            {videoEvent.notes && (
              <div className="detail-row">
                <span className="label">Notes:</span>
                <span>{videoEvent.notes}</span>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="action-buttons">
            <button className="btn btn-outline">
              📋 Review
            </button>
            <button className="btn btn-outline">
              ✓ Clear
            </button>
            <button className="btn btn-outline btn-danger">
              🚩 Flag
            </button>
            <button className="btn btn-outline">
              💾 Download
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        .video-viewer-modal {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .modal-backdrop {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.8);
        }

        .video-viewer {
          position: relative;
          z-index: 1001;
          background: var(--ai-surface);
          border: 1px solid var(--ai-line);
          border-radius: 14px;
          box-shadow: 0 28px 70px rgba(0, 0, 0, 0.55);
          width: 90%;
          max-width: 900px;
          max-height: 90vh;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
        }

        .video-player-container {
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .video-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .video-header h3 {
          margin: 0;
          font-size: 1.4rem;
          color: var(--ai-text);
        }

        .severity-badge {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 6px;
          color: white;
          font-size: 0.8rem;
          font-weight: 600;
          margin-left: 10px;
        }

        .close-btn {
          background: none;
          border: none;
          font-size: 1.8rem;
          color: var(--ai-muted);
          cursor: pointer;
          padding: 0;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          transition: background 0.2s;
        }

        .close-btn:hover {
          background: var(--ai-line);
          color: var(--ai-text);
        }

        .video-player {
          position: relative;
          width: 100%;
          background: #000;
          border-radius: 10px;
          overflow: hidden;
        }

        .video-player video {
          width: 100%;
          display: block;
        }

        .playback-controls {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: var(--ai-surface);
          border-radius: 8px;
        }

        .play-btn {
          padding: 8px 14px;
          background: var(--ai-gradient);
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
          font-size: 0.9rem;
        }

        .play-btn:hover {
          opacity: 0.9;
        }

        .time-display {
          flex: 1;
          font-size: 0.85rem;
          color: var(--ai-muted);
        }

        .telemetry-toggle {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--ai-text);
          font-size: 0.9rem;
          cursor: pointer;
        }

        .telemetry-toggle input {
          cursor: pointer;
        }

        .telemetry-panel {
          padding: 14px;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 8px;
          border: 1px solid var(--ai-line);
        }

        .telemetry-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
          margin-bottom: 12px;
        }

        .telemetry-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .telemetry-item .label {
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--ai-muted);
          font-weight: 600;
        }

        .telemetry-item .value {
          font-size: 1rem;
          color: var(--ai-text);
          font-weight: 600;
        }

        .progress-bar {
          width: 100%;
          height: 6px;
          background: var(--ai-line);
          border-radius: 3px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: var(--ai-gradient);
          transition: width 0.3s;
        }

        .ai-detection {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--ai-line);
        }

        .ai-detection h4 {
          margin: 0 0 8px;
          font-size: 0.9rem;
          color: var(--ai-text);
        }

        .detection-items {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .detection-item {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          font-size: 0.85rem;
        }

        .detection-item .type {
          color: var(--ai-text);
          font-weight: 500;
        }

        .detection-item .confidence {
          color: var(--ai-muted);
        }

        .event-details {
          padding: 12px;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 8px;
          font-size: 0.9rem;
        }

        .detail-row {
          display: flex;
          justify-content: space-between;
          padding: 6px 0;
          color: var(--ai-text);
        }

        .detail-row .label {
          color: var(--ai-muted);
          font-weight: 500;
        }

        .action-buttons {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .btn {
          padding: 10px 16px;
          border: 1px solid var(--ai-line);
          background: var(--ai-surface);
          color: var(--ai-text);
          border-radius: 8px;
          cursor: pointer;
          font-weight: 500;
          transition: all 0.2s;
          flex: 1;
        }

        .btn:hover {
          background: var(--ai-line);
        }

        .btn-danger {
          border-color: #ef4444;
          color: #ef4444;
        }

        .btn-danger:hover {
          background: rgba(239, 68, 68, 0.1);
        }

        @media (max-width: 768px) {
          .video-viewer {
            width: 95%;
            max-height: 95vh;
          }

          .telemetry-grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .action-buttons {
            flex-direction: column;
          }

          .btn {
            flex: auto;
          }
        }
      `}</style>
    </div>
  );
}

export default VideoViewer;
