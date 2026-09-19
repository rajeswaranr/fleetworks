import React, { useEffect, useRef, useState } from 'react';

/**
 * Live Video Player Component
 * Streams HLS video from Nginx RTMP server
 * Supports multi-camera switching (forward, rear, 360°, cabin)
 */
function LiveVideoPlayer({ vehicleId, onError }) {
  const [cameras, setCameras] = useState([
    { name: 'Front', stream: 'forward', icon: '📹' },
    { name: 'Rear', stream: 'rear', icon: '🔙' },
    { name: '360°', stream: '360_forward', icon: '🔄' },
    { name: 'Cabin', stream: 'cabin', icon: '👥' },
  ]);

  const [selectedCamera, setSelectedCamera] = useState('forward');
  const [isLive, setIsLive] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [latency, setLatency] = useState('3-5s');
  const [isRecording, setIsRecording] = useState(false);
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  // Get HLS stream URL
  const HLS_SERVER = process.env.REACT_APP_HLS_SERVER ||
                     process.env.VITE_HLS_SERVER ||
                     'http://localhost:8080/hls';

  const streamUrl = `${HLS_SERVER}/${selectedCamera}.m3u8`;

  // Initialize video player with HLS.js
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Check if HLS.js is available globally
    if (typeof window.HLS === 'undefined') {
      // Load HLS.js from CDN
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest/dist/hls.min.js';
      script.onload = () => initializeHLS();
      document.head.appendChild(script);
    } else {
      initializeHLS();
    }

    function initializeHLS() {
      const HLS = window.HLS;

      if (HLS?.isSupported()) {
        const hls = new HLS({
          debug: false,
          enableWorker: true,
          lowLatencyMode: true,
          liveBackBufferLength: 5,
          maxBufferLength: 10,
          maxMaxBufferLength: 20,
          maxBufferSize: 60 * 1000 * 1000,
          maxBufferHoleDuration: 30,
          fragLoadingTimeOut: 30000,
          manifestLoadingTimeOut: 30000,
          levelLoadingTimeOut: 30000,
        });

        hls.loadSource(streamUrl);
        hls.attachMedia(video);

        // Monitor stream health
        hls.on(HLS.Events.hlsFragParsed, () => {
          setIsLive(true);
          setLatency('3-5s');
        });

        hls.on(HLS.Events.hlsError, (event, data) => {
          if (data.fatal) {
            console.error('HLS fatal error:', data);
            onError?.('Stream connection lost');
            setIsLive(false);
          }
        });

        // Auto-play with muted audio
        video.muted = true;
        video.play().catch(() => {
          console.warn('Autoplay blocked - user interaction required');
        });

        return () => {
          hls.destroy();
        };
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari native HLS support
        video.src = streamUrl;
        video.play().catch(() => {
          console.warn('Autoplay blocked');
        });
      }
    }
  }, [selectedCamera, streamUrl, onError]);

  const handleCameraSwitch = (stream) => {
    setSelectedCamera(stream);
  };

  const toggleSound = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(!isMuted);
    }
  };

  const toggleFullscreen = () => {
    if (videoRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else if (videoRef.current.requestFullscreen) {
        videoRef.current.requestFullscreen();
      }
    }
  };

  const startRecording = () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      const stream = video.captureStream(30);
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9',
      });

      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dashcam-${selectedCamera}-${new Date().toISOString()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        setIsRecording(false);
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);

      // Auto-stop after 5 minutes
      setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      }, 5 * 60 * 1000);
    } catch (error) {
      console.error('Recording failed:', error);
      onError?.('Recording not supported');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  return (
    <div style={styles.container}>
      <style>{`
        ${Object.entries(styles).map(([key, style]) =>
          `.${key} { ${Object.entries(style).map(([k, v]) =>
            `${k.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${v};`
          ).join('') } }`
        ).join('\n')}

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .live-badge { animation: pulse 1.5s infinite; }
      `}</style>

      <div style={styles.videoWrapper}>
        <video
          ref={videoRef}
          style={styles.videoElement}
          controlsList="nodownload"
          onContextMenu={(e) => e.preventDefault()}
        />

        {/* Video Overlay */}
        <div style={styles.overlay}>
          {/* Top Bar */}
          <div style={styles.topBar}>
            <div style={styles.statusLeft}>
              <div style={styles.liveBadge}>
                🔴 {isLive ? 'LIVE' : 'OFFLINE'}
              </div>
            </div>
            <div style={styles.statusRight}>
              <div style={styles.latencyBadge}>
                ⏱️ {latency}
              </div>
            </div>
          </div>

          {/* Bottom Controls */}
          <div style={styles.controlsContainer}>
            {/* Camera Selector */}
            <div style={styles.cameraGrid}>
              {cameras.map((cam) => (
                <button
                  key={cam.stream}
                  style={{
                    ...styles.cameraBtn,
                    ...(selectedCamera === cam.stream
                      ? styles.cameraBtnActive
                      : styles.cameraBtnInactive
                    ),
                  }}
                  onClick={() => handleCameraSwitch(cam.stream)}
                >
                  {cam.icon} {cam.name}
                </button>
              ))}
            </div>

            {/* Action Buttons */}
            <div style={styles.actionButtons}>
              <button
                style={styles.controlBtn}
                onClick={toggleSound}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? '🔇' : '🔊'} Sound
              </button>

              <button
                style={styles.controlBtn}
                onClick={toggleFullscreen}
                title="Fullscreen"
              >
                ⛶ Fullscreen
              </button>

              {!isRecording ? (
                <button
                  style={styles.controlBtn}
                  onClick={startRecording}
                  title="Record video"
                >
                  ⏺️ Record
                </button>
              ) : (
                <button
                  style={{ ...styles.controlBtn, background: 'rgba(239, 68, 68, 0.6)' }}
                  onClick={stopRecording}
                  title="Stop recording"
                >
                  ⏹️ Stop
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div style={styles.statusBar}>
        <div style={styles.statusItem}>
          <div style={styles.statusLabel}>Camera</div>
          <div style={styles.statusValue}>
            {cameras.find((c) => c.stream === selectedCamera)?.name || 'Unknown'}
          </div>
        </div>
        <div style={styles.statusItem}>
          <div style={styles.statusLabel}>Status</div>
          <div style={styles.statusValue}>{isLive ? '🟢 LIVE' : '🔴 OFFLINE'}</div>
        </div>
        <div style={styles.statusItem}>
          <div style={styles.statusLabel}>Latency</div>
          <div style={styles.statusValue}>{latency}</div>
        </div>
        <div style={styles.statusItem}>
          <div style={styles.statusLabel}>Recording</div>
          <div style={styles.statusValue}>{isRecording ? '🔴 ON' : '⚪ OFF'}</div>
        </div>
      </div>
    </div>
  );
}

// Inline styles
const styles = {
  container: {
    background: '#000',
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
  },

  videoWrapper: {
    position: 'relative',
    width: '100%',
    paddingBottom: '56.25%',
    background: '#000',
  },

  videoElement: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },

  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '12px',
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, transparent 50%, rgba(0,0,0,0.4) 100%)',
    pointerEvents: 'none',
  },

  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    pointerEvents: 'auto',
  },

  statusLeft: {
    display: 'flex',
    gap: '8px',
  },

  statusRight: {
    display: 'flex',
    gap: '8px',
  },

  liveBadge: {
    background: '#ef4444',
    color: 'white',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 'bold',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },

  latencyBadge: {
    background: 'rgba(0, 0, 0, 0.6)',
    color: '#60a5fa',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    fontFamily: 'monospace',
  },

  controlsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    pointerEvents: 'auto',
  },

  cameraGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '8px',
  },

  cameraBtn: {
    padding: '8px 12px',
    border: '2px solid #444',
    background: '#222',
    color: '#888',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
    transition: 'all 0.3s',
  },

  cameraBtnActive: {
    borderColor: '#3b82f6',
    background: '#1e40af',
    color: 'white',
  },

  cameraBtnInactive: {
    ':hover': {
      borderColor: '#666',
      background: '#333',
    },
  },

  actionButtons: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'flex-end',
  },

  controlBtn: {
    background: 'rgba(0, 0, 0, 0.6)',
    border: '1px solid #666',
    color: 'white',
    padding: '6px 12px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '500',
    transition: 'all 0.2s',
  },

  statusBar: {
    background: 'rgba(0, 0, 0, 0.8)',
    padding: '8px 12px',
    color: '#60a5fa',
    fontSize: '12px',
    fontFamily: 'monospace',
    borderTop: '1px solid #333',
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '16px',
  },

  statusItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },

  statusLabel: {
    color: '#888',
    fontSize: '11px',
    textTransform: 'uppercase',
  },

  statusValue: {
    color: '#60a5fa',
    fontWeight: 'bold',
  },
};

export default LiveVideoPlayer;
