# AI Based Camera

## Discussion purpose

FleetWorks plans to install IoT-connected AI cameras in commercial vehicles and integrate safety alerts with:

- The assigned driver's FleetWorks login.
- The driver's WhatsApp, for selected alerts.
- The owner or supervisor's WhatsApp.
- The vehicle instant-monitoring page.

This note records the initial technical scope and workflow discussion. It does not contain an implementation or confirmed Jimiiot API contract.

## JC451 capability summary

Based on the supplied JC451 multi-channel leaflet, the device supports:

- Up to five camera channels, depending on configuration.
- Road, cabin, rear, side and cargo camera options.
- GPS/BDS positioning and 4G communication.
- ADAS: forward-collision warning, headway monitoring and lane-departure warning.
- Optional DMS: phone use, smoking, distraction, yawning, eyes closed and no-face detection.
- Optional face recognition and seatbelt detection.
- A 3-axis accelerometer.
- TF-card storage up to 256 GB.
- `.ts` video recording.
- Speaker, microphone, SOS and digital inputs.
- Wi-Fi, Bluetooth and OTA firmware updates.

Important: the leaflet indicates that DMS, facial recognition and seatbelt detection require the JC171 AI camera configuration. The JC451 main unit alone does not guarantee these AI functions.

## Recommended camera arrangement

| Channel | View | Purpose |
|---|---|---|
| CH1 | Road-facing | Collision, headway and lane-departure detection |
| CH2 | Driver-facing JC171 | Fatigue, distraction, phone, smoking and seatbelt detection |
| CH3 | Rear-facing | Accident evidence and reversing visibility |
| CH4 | Cargo/load area | Cargo access, tampering and load verification |
| CH5 | Side/blind spot | Side-collision evidence and unsafe manoeuvres |

Road-facing and driver-facing cameras are the minimum recommended configuration for the first rollout.

## Proposed system workflow

```text
JC451 and cameras
        -> 4G network / Jimiiot platform
        -> JC451 vendor adapter
        -> Raw event and telemetry storage
        -> FleetWorks normalized safety event
        -> Severity, validation and duplicate suppression
        -> Safety incident
        -> Live monitor, driver portal and WhatsApp
        -> Acknowledgement, escalation and closure
```

FleetWorks should isolate vendor-specific fields inside an adapter. All FleetWorks screens, rules and notifications should consume a stable internal event format. This allows another device vendor to be supported without redesigning the safety workflow.

## Expected data categories

### Continuous telemetry

- Device IMEI and online status.
- Location, speed and heading.
- Ignition status.
- Network signal and GPS quality.
- Storage-card and camera-channel health.
- Device voltage, temperature and firmware.
- Last communication time.

### AI and safety events

- Fatigue, eyes closed and yawning.
- Phone use, smoking and distraction.
- Seatbelt missing.
- Forward-collision risk.
- Unsafe following distance.
- Lane departure.
- Driver identity mismatch.
- Camera obstruction or tampering.
- SOS/panic.
- Harsh braking, acceleration and cornering.

### Media

- Event snapshot.
- Short pre-event and post-event video.
- On-demand photograph.
- Recorded-video playback.
- Live stream.
- Camera-channel identity.

Large video files should normally remain in vendor or object storage. FleetWorks should retain protected media references, metadata and expiring access links.

## Illustrative normalized API event

The following is a proposed FleetWorks data shape, not a confirmed Jimiiot payload:

```json
{
  "event_id": "evt_20260907_000145",
  "event_type": "driver_fatigue",
  "severity": "critical",
  "status": "open",
  "occurred_at": "2026-09-07T16:27:42+05:30",
  "device": {
    "imei": "867xxxxxxxxxxxx",
    "model": "JC451",
    "firmware": "1.4.2"
  },
  "vehicle": {
    "vehicle_id": "veh_1028",
    "registration_number": "TN 01 AB 4582"
  },
  "driver": {
    "driver_id": "drv_229",
    "name": "Ramesh Kumar",
    "identity_confidence": 0.96
  },
  "location": {
    "latitude": 12.97142,
    "longitude": 77.59463,
    "speed_kmph": 68,
    "heading": 124
  },
  "ai_result": {
    "camera_channel": "cabin",
    "confidence": 0.94,
    "duration_seconds": 4.8,
    "attributes": {
      "eyes_closed": true,
      "yawning": false,
      "phone_detected": false,
      "seatbelt_detected": true
    }
  },
  "evidence": {
    "snapshot_url": "protected-expiring-url",
    "video_url": "protected-expiring-url",
    "video_start_offset_seconds": -10,
    "video_end_offset_seconds": 10
  },
  "notifications": {
    "driver_portal": "delivered",
    "driver_whatsapp": "queued",
    "owner_whatsapp": "delivered",
    "monitoring_page": "delivered"
  }
}
```

AI evidence should ideally include the original image, a marked-up review image, detected-object boxes, event label, confidence score, time, vehicle/device identity, speed and location.

## Alert policy

| Severity | Examples | Driver portal | Driver WhatsApp | Owner WhatsApp | Live monitor |
|---|---|---:|---:|---:|---:|
| Information | Seatbelt corrected, device restored | Yes | No | No | Yes |
| Warning | Single lane departure or mild distraction | Yes | Usually no | Optional digest | Yes |
| Critical | Fatigue, collision risk or repeated phone use | Yes | Yes | Yes | Immediate |
| Emergency | Crash or SOS | Yes | Yes | Owner and supervisor | Full escalation |

The primary driver warning should be an in-cab sound or voice warning where the device supports it. WhatsApp should not encourage a moving driver to look at a phone. Driver WhatsApp is better suited to critical escalation, post-event follow-up or alerts delivered after the vehicle has stopped.

Repeated detections should be grouped. For example, ten fatigue observations within two minutes should normally become one incident containing ten observations, rather than ten WhatsApp messages.

## Live vehicle-monitoring page

Recommended information and actions:

- Current position and route trail.
- Online/offline status and last contact.
- Speed, ignition and heading.
- Camera and storage health.
- Assigned driver.
- Latest AI event.
- Latest authorized camera thumbnails.
- Open incident count.
- Driver acknowledgement status.
- View evidence.
- Request snapshot.
- Start authorized live view.
- Call driver.
- Acknowledge or escalate.

Fleet-wide incident priority should be:

1. SOS or emergency.
2. Critical unacknowledged events.
3. Repeated warnings.
4. Offline or tampered devices.
5. Normal online vehicles.

## Incident lifecycle

```text
Detected
  -> Validated
  -> Open
  -> Driver notified
  -> Owner/supervisor notified
  -> Acknowledged
  -> Action taken
  -> Closed
```

Possible closure reasons include driver rested, false positive, supervisor contacted the driver, vehicle parked safely, emergency assistance dispatched, camera fault, or duplicate incident merged.

## Fit with the current FleetWorks foundation

FleetWorks already has a useful starting point:

- Device inventory and vehicle-device links.
- Continuous telemetry storage.
- Separate ADAS/DMS safety events.
- Severity and acknowledgement fields.
- GPS, speed and video-link fields.
- Driver and vehicle records.
- WhatsApp contacts, consent and message history.
- An IoT telemetry module boundary.

The live ingestion adapter is not yet connected. Principal additions are:

- JC451/Jimiiot adapter.
- Secure event-ingestion endpoint.
- Media retrieval and protected storage.
- Vehicle and driver enrichment.
- Alert rules and duplicate suppression.
- Realtime monitoring delivery.
- Notification orchestration and retry.
- Incident acknowledgement and escalation.
- Device and camera health monitoring.

The event model should later be extended with driver, camera channel, AI confidence, evidence metadata, incident grouping, notification delivery, escalation and closure details.

## Questions requiring Jimiiot API documentation

1. Does Jimiiot push events using webhooks, or must FleetWorks poll?
2. Is integration through the Jimiiot cloud API or a direct device protocol?
3. What are the exact event/alarm codes?
4. Are snapshot and event-video links included with an event?
5. How are recorded clips requested and downloaded?
6. Which live-stream protocol is provided?
7. How long are cloud recordings retained?
8. Can FleetWorks request snapshots or live viewing remotely?
9. Are pre-event and post-event clips supported?
10. How are API requests authenticated and signed?
11. Does webhook delivery retry after failure?
12. Is there a stable unique event ID for duplicate detection?
13. What is typical event-to-cloud latency?
14. Are AI confidence and face-recognition results exposed?
15. Are camera, storage and tamper faults exposed?
16. Is Indian carrier and 4G-band compatibility confirmed for the supplied model?

## Recommended rollout

### Phase 1 - Proof of concept

- Install two or three vehicles.
- Validate GPS, device heartbeat and vehicle association.
- Validate fatigue, phone, seatbelt, collision and SOS events.
- Test snapshot and video retrieval.
- Demonstrate live monitoring.
- Test driver and owner notifications.
- Measure latency and false positives.

### Phase 2 - Controlled pilot

- Deploy approximately 10-20 vehicles.
- Tune duplicate suppression and sensitivity.
- Add driver acknowledgement and supervisor escalation.
- Monitor camera/device health.
- Create weekly safety reports.
- Tune settings separately for highway and city operation.

### Phase 3 - Production

- High-availability ingestion.
- Retry and dead-letter handling.
- Complete audit history.
- Media-retention policy.
- Role-based camera access.
- Consent and privacy controls.
- Bandwidth and cost controls.
- Multi-vendor adapter support.
- Safety scorecards and coaching.

## Core design decision

This should be treated as a safety incident-management system, not merely a camera-feed feature. The platform must determine whether an alert is valid and critical, group duplicates, notify the correct people, track delivery and acknowledgement, record action taken, and preserve the reason and time of closure.

## Next input needed

Obtain the JC451/Jimiiot API or protocol documentation covering authentication, event codes, webhooks, media retrieval and live streaming. The actual vendor payloads can then be mapped field-by-field into the proposed FleetWorks format and the implementation scope can be finalized.
