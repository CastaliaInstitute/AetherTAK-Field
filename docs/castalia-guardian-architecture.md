# Castalia Guardian software architecture

Version: 1.0  
Status: Proposed implementation baseline  
Owners: Castalia Institute  
Last updated: 2026-07-30

## 1. Purpose

Castalia Guardian is the people-safety subsystem of the AetherTAK platform. It
collects consented participant telemetry, produces a current and uncertainty-
aware location estimate, evaluates property geofences and check-ins, and
publishes the minimum operational state required by TAK clients.

This specification turns the Guardian 0.1 concept into an implementation
baseline. It defines component boundaries, transport contracts, security
controls, storage, APIs, TAK extensions, deployment, testing, and phased work.

Guardian is not a medical device, a substitute for adult supervision, or a
guaranteed emergency service. Every interface must show the age, source, and
confidence of the last observation. Loss of telemetry is a first-class state,
not evidence that a participant is safe.

## 2. Scope

### 2.1 In scope

- Participant, guardian, device, gateway, zone, and consent registries
- GPS, gateway-presence, motion, battery, check-in, SOS, and contextual
  biometric observations
- Zepp OS / Amazfit Active 2 companion integration
- Direct BLE support for future ESP32 and Astrolabe wearables
- Property Wi-Fi or Ethernet gateway backhaul
- Meshtastic fallback backhaul
- MQTT ingestion and event distribution
- Location fusion, geofences, check-ins, and alert lifecycle
- PostgreSQL/PostGIS persistence and configurable retention
- AetherTAK Field synchronization and TAK Cursor-on-Target publication
- Supervisor dashboard and auditable acknowledgement

### 2.2 Out of scope for v1

- Medical diagnosis or treatment recommendations
- Facial recognition, covert tracking, or continuous audio recording
- Fully autonomous dispatch, drone launch, or robotic intervention
- Claims of certified life-safety availability
- Camera surveillance as a participant-tracking source
- Precise indoor ranging from uncalibrated RSSI

## 3. Architectural decisions

### ADR-001: The telemetry service is authoritative

PostgreSQL and the Guardian services own participant identity, consent,
observations, fused state, alerts, acknowledgement, and retention. MQTT is a
transport, Redis is disposable coordination state, and TAK is a dissemination
and coordination view. None is the system of record.

### ADR-002: Amazfit Active 2 is a companion-mode wearable

Zepp OS documents BLE communication between its Device App and a Side Service
running in the Zepp phone application. It also documents background App
Services, but high-power sensors such as geolocation and accelerometer are not
available to a background App Service. Consequently:

- Active 2 telemetry flows `watch -> Zepp BLE -> phone Side Service -> Guardian`.
- GPS and motion sampling that require high-power sensors occur while the
  appropriate foreground watch experience is active, or come from the phone.
- Background heart-rate and low-power state may be available only where the
  device API level and granted permissions allow it.
- Active 2 is not the sole safety beacon for a participant who does not carry
  the paired phone.

Direct property-gateway BLE is reserved for an ESP32/Astrolabe wearable whose
firmware and GATT peripheral behavior Castalia controls. This must be clear in
product language and field procedures.

### ADR-003: BLE presence is zone-level evidence

Gateway RSSI is used to identify the most plausible nearby gateway or calibrated
room/zone. It is not converted to an exact point without site calibration and
an error model. GPS remains the preferred outdoor position.

### ADR-004: Biometrics are not placed on the general TAK feed

The standard participant CoT includes operational state, location confidence,
battery, connectivity, zone, and alert state. Raw heart rate and other
biometrics remain in Guardian and require a separate `medical` permission.
If a medical workflow later needs TAK dissemination, it must use a separately
authorized group/feed and a documented retention policy.

### ADR-005: Al is advisory and read-only

Al may summarize evidence and propose operator actions. It may not acknowledge
alerts, change geofences, enroll devices, alter retention, or publish emergency
events. Every Al insight carries source observation identifiers and expiration.

## 4. Logical architecture

```text
 Zepp OS watch              Castalia wearable
 Device App                 ESP32/Astrolabe
      | Zepp BLE                  | Guardian GATT
 Zepp Side Service               BLE gateway
      | HTTPS/mTLS                | Wi-Fi/Ethernet
      +------------+--------------+
                   |
             MQTT ingress <-------- Meshtastic bridge
                   |
          Guardian ingest service
                   |
        PostgreSQL/PostGIS + Redis
                   |
      +------------+-------------+
      |            |             |
 fusion worker  rule engine   retention worker
      |            |
      +------ fused state / alerts
                   |
          TAK publication service
                   |
              AetherTAK Server
                   |
    +--------------+----------------+
 AetherTAK Field   iTAK / ATAK      Web dashboard
```

## 5. Trust boundaries

| Boundary | Trust rule |
| --- | --- |
| Wearable to phone/gateway | Enrolled device identity, replay protection, bounded packet size |
| Gateway to MQTT | Per-gateway certificate and topic ACL |
| Meshtastic mesh | Private channel PSK; signed Guardian payload; packet deduplication |
| Service to database | Dedicated least-privilege database roles |
| Guardian to TAK | Dedicated TAK client certificate and allow-listed CoT encoder |
| Mobile/dashboard to Guardian | Issued client certificate plus role authorization |
| Al to Guardian | Read-only API token; no command, alert, or acknowledgement permission |

No private key, PSK, bearer token, participant name, exact location, or biometric
value may be written to routine application logs.

## 6. Components

### 6.1 Guardian Watch Mini Program

Responsibilities:

- Explicit start/stop and visible tracking state
- SOS, return-home, and check-in user actions
- Foreground location and motion sampling when supported
- Contextual heart-rate sampling with user permission
- Battery and connection reporting
- Compact protobuf serialization
- Local sequence counter and bounded retry queue
- Vibration/notification for acknowledged commands

The Zepp Side Service forwards binary frames using HTTPS to the Guardian ingest
endpoint. It does not store long-term history. If the phone is offline it keeps
a bounded encrypted queue and reports the gap when service returns.

### 6.2 Castalia direct wearable

An ESP32/Astrolabe wearable implements the Guardian GATT service in section 9.
It provides direct gateway connectivity for participants without a phone. A
production child-safety pilot requires this device or another independently
verified direct-connect beacon.

### 6.3 BLE gateway agent

Each gateway:

- Scans only for enrolled Guardian service advertisements
- Connects only when telemetry or a command exchange is pending
- Attaches gateway ID, receive time, RSSI, and link state
- Verifies device signatures before forwarding when resource limits permit
- Publishes through a per-gateway MQTT identity
- Buffers a bounded queue during broker loss
- Reports firmware, uptime, power, temperature, queue depth, and last success

Gateways never translate RSSI into a precise coordinate. They publish raw RSSI
and their registered coordinate/zone; fusion owns interpretation.

### 6.4 Meshtastic bridge

The bridge consumes the official Meshtastic Client API over serial, TCP, or BLE
and accepts only Guardian application payloads from an allow-list of node IDs
and channels. It:

- Decodes the Meshtastic ServiceEnvelope or Client API packet
- Deduplicates by mesh packet ID and Guardian envelope ID
- Preserves hop count, source node, channel, receive time, and radio metadata
- Publishes normalized frames to the Guardian MQTT ingress topic
- Applies strict rate and size limits

Use a private Meshtastic channel with a random 32-byte PSK. Do not use the
public MQTT service or default channel key for precise participant locations.
Only one bridge should downlink a given command; use a short lease in Redis to
avoid duplicate mesh transmissions.

### 6.5 MQTT broker

Recommended topic layout:

```text
guardian/v1/{property_id}/ingest/{transport}/{source_id}
guardian/v1/{property_id}/gateway/{gateway_id}/status
guardian/v1/{property_id}/device/{device_id}/desired
guardian/v1/{property_id}/device/{device_id}/reported
guardian/v1/{property_id}/event/alert
guardian/v1/{property_id}/event/state
```

Rules:

- MQTT 5 over TLS; client certificates for fixed infrastructure
- QoS 1 for telemetry, status, alert, and command messages
- Telemetry and commands are not retained
- Versioned desired configuration may be retained and must expire
- ACLs bind each client to its exact property/source topic prefix
- Maximum payload: 16 KiB at broker; Guardian BLE target: 512 bytes
- Ingest is idempotent by `envelope_id`
- Broker persistence is operational buffering, not historical retention

ChirpStack remains on its documented
`application/{application_id}/device/{dev_eui}/event/{event}` topics. A
normalizer converts selected uplinks to AetherTAK Field sensor readings; it does
not publish participant biometrics.

### 6.6 Ingest service

FastAPI accepts HTTPS batches and an internal gRPC stream. It:

1. Authenticates the transport identity.
2. Parses a bounded protobuf envelope.
3. Verifies device ID, signature, sequence, and timestamp window.
4. Stores an immutable raw observation with ingest metadata.
5. Publishes the observation ID to the fusion queue.
6. Returns an idempotent receipt.

Invalid packets are quarantined with a reason code and payload digest, not raw
sensitive content.

### 6.7 Fusion worker

Fusion is deterministic and replayable. Given an ordered observation stream it
produces a versioned `participant_state` row.

Location source priority:

| Source | Use | Default accuracy |
| --- | --- | --- |
| Valid recent GPS | Exact outdoor position | Reported accuracy, floored at 3 m |
| Calibrated multi-gateway estimate | Bounded indoor estimate | Calibration error model |
| Single BLE gateway | Registered gateway/zone center | Zone radius or configured uncertainty |
| Meshtastic position | Fallback point | Reported precision plus bridge age |
| Last known | Display only | Accuracy grows with age; clearly stale |

Additional rules:

- Reject impossible coordinates, non-monotonic sequences, and implausible
  speed unless an operator marks a transport discontinuity.
- Prefer newer evidence only when its quality is sufficient.
- Keep source time and receive time separately.
- Do not silently move a participant to a gateway coordinate; mark the source
  as `ble_presence`.
- Publish state only when materially changed or at a bounded heartbeat.

### 6.8 Rule engine

The rule engine consumes fused state and produces durable alert transitions.
Every rule has dwell, hysteresis, cooldown, and missing-data behavior.

Required v1 rules:

- SOS initiated/cancelled
- Red-zone entry
- Yellow-zone entry
- Property exit
- Device separation
- Missed check-in
- Stationary too long
- Low battery
- GPS unavailable
- Telemetry stale/lost
- Returned to safe zone

Geofence evaluation uses PostGIS against the uncertainty geometry, not just the
point. A red-zone alert enters when the uncertainty circle intersects the red
zone for the configured dwell. It resolves only after the circle is clear for
the exit dwell or an authorized operator resolves it with a reason.

An alert has these states:

```text
candidate -> active -> acknowledged -> resolved
                 \--------------------> resolved
```

Acknowledgement means an authorized person has seen the alert. It does not mean
the condition is safe. Resolution requires a reason and is independently
audited.

### 6.9 TAK publisher

The publisher maintains one stable participant UID:

```text
CASTALIA-GUARDIAN.{participant_uuid}
```

Normal participant PLI uses the existing AetherTAK Field compatible CoT type
`a-f-G-U-C`, `how` based on source, and a stale interval derived from expected
cadence. The publisher sends a fresh event on a material change and a bounded
heartbeat. It sends a separate emergency CoT only for an SOS or configured
critical escalation.

The publisher is stateless apart from a durable outbox and last-published
digest. It may be replayed from Guardian state without changing participant
identity.

### 6.10 AetherTAK Field and dashboard

AetherTAK Field receives:

- Standard TAK participant markers and emergency events
- Guardian participant, zone, check-in, and alert records through the ordered
  mTLS field API change feed
- Read-only Al insights referencing stored evidence

The Guardian dashboard adds roster, alert queue, gateway health, last-contact
age, uncertainty, check-ins, and incident playback. Exact history and
biometrics require explicit permissions.

The first AetherTAK Field vertical slice is implemented for participant state.
`guardian_participant` changes are validated as strict, server-managed records
inside the existing ordered mTLS field change feed, stored in IndexedDB for
offline use, and rendered as an urgency-ordered roster, participant point, and
meter-based uncertainty polygon. Missing accuracy uses conservative
source-specific defaults. Undeclared fields—including biometric values—fail
validation without advancing the durable change cursor. Mobile mutation of
participant state is intentionally unavailable.

The property safety overlay also persists strict, publisher-managed
`guardian_zone` projections. Each zone is tied to a property and carries a
closed, bounded polygon, green/yellow/red level, active state, and explicit
entry/exit dwell settings. Active zones render beneath participant uncertainty
on the field map and remain available offline. Undeclared fields, open
boundaries, invalid coordinates, and excessive geometry fail validation on
both the Field API and mobile client without advancing the durable cursor.
Mobile clients cannot author or alter authoritative safety zones.

The mobile safety workflow persists strict `guardian_alert` projections and a
separate local action outbox. Check-in, acknowledgement, and resolution use a
stable UUID as `Idempotency-Key`; retries reuse that key. Swift and Kotlin map
the bounded action enum to fixed `/guardian/v1` routes inside the native mTLS
boundary, so JavaScript cannot supply an arbitrary path or header. A resolution
requires an explicit 3–500 character reason. Failed actions remain visible for
operator retry or deliberate discard, and successful actions disappear only
after an exact matching receipt. Acknowledgement remains distinct from
resolution in both the schema and interface.

## 7. Canonical protobuf contract

The initial source file is `proto/castalia/guardian/v1/telemetry.proto`.
Generated code is checked in only where a target toolchain requires it.

```proto
syntax = "proto3";

package castalia.guardian.v1;

import "google/protobuf/timestamp.proto";

message TelemetryEnvelope {
  string envelope_id = 1;       // UUID
  string device_id = 2;         // UUID; no participant name
  string boot_id = 3;           // UUID, regenerated at boot
  uint64 sequence = 4;          // monotonic within boot_id
  google.protobuf.Timestamp observed_at = 5;
  repeated Observation observations = 6;
  bytes signer_key_id = 7;
  bytes signature = 8;          // signature over canonical fields 1..7
  uint32 schema_version = 9;
}

message Observation {
  oneof value {
    LocationFix location = 1;
    Motion motion = 2;
    Biometric biometric = 3;
    Battery battery = 4;
    ParticipantAction action = 5;
    LinkState link = 6;
  }
}

message LocationFix {
  sint32 latitude_e7 = 1;
  sint32 longitude_e7 = 2;
  sint32 altitude_mm = 3;
  uint32 horizontal_accuracy_mm = 4;
  uint32 vertical_accuracy_mm = 5;
  uint32 speed_mmps = 6;
  uint32 heading_cdeg = 7;
  LocationSource source = 8;
}

enum LocationSource {
  LOCATION_SOURCE_UNSPECIFIED = 0;
  WATCH_GNSS = 1;
  PHONE_GNSS = 2;
  MESHTASTIC_POSITION = 3;
}

message Motion {
  MotionState state = 1;
  uint32 confidence_permille = 2;
  bool device_removed_candidate = 3;
  bool fall_candidate = 4;
}

enum MotionState {
  MOTION_STATE_UNSPECIFIED = 0;
  STATIONARY = 1;
  WALKING = 2;
  RUNNING = 3;
  VEHICLE = 4;
  UNKNOWN = 5;
}

message Biometric {
  oneof value {
    uint32 heart_rate_bpm = 1;
    uint32 oxygen_saturation_permille = 2;
    sint32 skin_temperature_mc = 3;
  }
  BiometricQuality quality = 4;
}

enum BiometricQuality {
  BIOMETRIC_QUALITY_UNSPECIFIED = 0;
  GOOD = 1;
  ESTIMATED = 2;
  SUSPECT = 3;
}

message Battery {
  uint32 percent = 1;
  bool charging = 2;
}

message ParticipantAction {
  ActionType type = 1;
  string nonce = 2;
}

enum ActionType {
  ACTION_TYPE_UNSPECIFIED = 0;
  SOS = 1;
  CANCEL_SOS = 2;
  CHECK_IN = 3;
  REQUEST_RETURN_HOME = 4;
}

message LinkState {
  bool watch_phone_connected = 1;
  sint32 rssi_dbm = 2;
}

message GatewayReceipt {
  string envelope_id = 1;
  string gateway_id = 2;
  google.protobuf.Timestamp received_at = 3;
  sint32 rssi_dbm = 4;
  uint32 connection_quality_permille = 5;
  string zone_hint = 6;
  Transport transport = 7;
  string mesh_packet_id = 8;
  uint32 mesh_hop_count = 9;
}

enum Transport {
  TRANSPORT_UNSPECIFIED = 0;
  ZEPPSIDE_HTTPS = 1;
  GUARDIAN_BLE = 2;
  WIFI = 3;
  MESHTASTIC = 4;
}
```

Signature algorithm for the prototype is Ed25519. The exact serialized bytes
covered by the signature must be specified with deterministic protobuf
serialization test vectors. If a target cannot safely provide Ed25519 private
key storage, that target operates through an authenticated companion identity
and is marked `companion_attested`, not `device_attested`.

## 8. Observation semantics

- `observed_at` is device time; server `received_at` is always recorded.
- Clock skew over five minutes is accepted only as `clock_untrusted` and never
  reorders already accepted observations.
- Duplicate `(device_id, boot_id, sequence)` values are idempotent.
- A new `boot_id` requires a recent enrollment or a valid device signature.
- Zero and missing values are distinct; protobuf presence is used where
  ambiguity matters.
- The server maps `device_id` to a participant only during an active assignment.
- Reassignment never rewrites historical participant ownership.

## 9. Guardian BLE GATT service

This service applies to Castalia-controlled direct wearables, not the Amazfit
Active 2 Zepp link.

Service UUID:

```text
7b9f0000-6d5b-4a64-9d8c-4b4a47554152
```

| Characteristic | UUID suffix | Properties | Direction | Maximum value |
| --- | --- | --- | --- | --- |
| Device info | `0001` | Read | Gateway <- wearable | 128 bytes |
| Telemetry | `0002` | Notify | Gateway <- wearable | Negotiated ATT MTU |
| Receipt | `0003` | Write, Indicate | Gateway -> wearable | 128 bytes |
| Command | `0004` | Write, Indicate | Gateway -> wearable | 256 bytes |
| Time/config | `0005` | Read, Write | Bidirectional | 256 bytes |

All characteristic UUIDs replace the last four hex digits of the service
UUID's first group with the suffix, for example `7b9f0002-...` for Telemetry.

Protocol:

1. BLE advertisement contains the service UUID and an eight-byte rotating
   enrollment alias; it contains no participant name.
2. Gateway connects using LE Secure Connections and an enrolled bond.
3. Wearable fragments a length-prefixed `TelemetryEnvelope`.
4. Each fragment carries protocol version, envelope ID prefix, fragment index,
   fragment count, and CRC-16 for transport corruption detection.
5. Gateway reassembles at most 16 KiB and verifies the envelope signature.
6. Gateway writes an authenticated receipt only after either the server accepts
   the envelope or the gateway has fsynced it into its own durable queue.
7. The receipt states `server_accepted` or `gateway_custody`. Once a wearable
   accepts `gateway_custody`, that gateway owns retry until server acceptance.
8. The wearable removes data from its bounded queue only after a valid receipt.

Commands use unique nonces, expiry, and a monotonic server command sequence.
Wearables reject expired or replayed commands. Remote vibration or return-home
prompts are allowed; silent tracking enablement is not.

## 10. TAK Cursor-on-Target contract

Example participant PLI:

```xml
<event version="2.0"
       uid="CASTALIA-GUARDIAN.88be2f51-6e6d-4a0a-85bf-0fa42d25a0de"
       type="a-f-G-U-C"
       how="m-g"
       time="2026-07-30T15:00:00.000Z"
       start="2026-07-30T15:00:00.000Z"
       stale="2026-07-30T15:01:00.000Z">
  <point lat="39.0000000" lon="-105.0000000"
         hae="2500" ce="8" le="15"/>
  <detail>
    <contact callsign="Participant 7"/>
    <__group name="Green" role="Team Member"/>
    <status battery="72"/>
    <track course="184" speed="1.2"/>
    <guardian schema="1"
              participant_id="88be2f51-6e6d-4a0a-85bf-0fa42d25a0de"
              mode="child"
              state="normal"
              zone="orchard"
              alert="none"
              checkin="current">
      <location source="watch_gnss"
                confidence="good"
                observed_at="2026-07-30T14:59:58.000Z"/>
      <device connectivity="watch_phone_wifi"
              last_contact_seconds="2"/>
    </guardian>
  </detail>
</event>
```

Rules:

- XML values are escaped and bounded before encoding.
- Unknown custom detail must not be required to render the standard marker.
- No raw biometric, guardian name, consent record, or date of birth is sent.
- `ce` and `le` express uncertainty; unknown values use TAK-compatible large
  errors rather than false precision.
- A single gateway BLE presence uses `how="h-e"` and zone-derived `ce`.
- GPS uses `how="m-g"`.
- Last-known replay preserves the original observation time and has a short
  stale time; it is not refreshed indefinitely.
- SOS uses the existing AetherTAK emergency lifecycle and a stable emergency
  UID so cancellation reconciles correctly.

Custom-detail compatibility tests must cover AetherTAK Field, current iTAK,
current ATAK, and WinTAK before the detail is enabled by default.

## 11. PostgreSQL/PostGIS schema

The migration below describes the core tables; production migrations add
indexes, comments, database roles, and row-level policies.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE participant_mode AS ENUM
  ('child', 'guest', 'supervisor', 'medical');
CREATE TYPE alert_severity AS ENUM
  ('info', 'warning', 'critical');
CREATE TYPE alert_status AS ENUM
  ('candidate', 'active', 'acknowledged', 'resolved');
CREATE TYPE zone_level AS ENUM
  ('green', 'yellow', 'red');

CREATE TABLE property (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  timezone text NOT NULL,
  boundary geometry(Polygon, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE participant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES property(id),
  display_name text NOT NULL,
  mode participant_mode NOT NULL,
  team text NOT NULL DEFAULT 'Green',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz
);

CREATE TABLE consent_grant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participant(id),
  granted_by text NOT NULL,
  scopes text[] NOT NULL,
  starts_at timestamptz NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE device (
  id uuid PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES property(id),
  kind text NOT NULL,
  public_key bytea,
  attestation text NOT NULL,
  firmware_version text,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE participant_device_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participant(id),
  device_id uuid NOT NULL REFERENCES device(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  UNIQUE (device_id, starts_at)
);

CREATE TABLE gateway (
  id uuid PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES property(id),
  name text NOT NULL,
  zone_hint text,
  coordinate geometry(PointZ, 4326) NOT NULL,
  uncertainty_m double precision NOT NULL CHECK (uncertainty_m > 0),
  certificate_serial text NOT NULL UNIQUE,
  last_contact_at timestamptz,
  status jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE zone (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES property(id),
  name text NOT NULL,
  level zone_level NOT NULL,
  boundary geometry(Polygon, 4326) NOT NULL,
  enter_dwell_seconds integer NOT NULL DEFAULT 10,
  exit_dwell_seconds integer NOT NULL DEFAULT 20,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE telemetry_envelope (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES device(id),
  boot_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 0),
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  transport text NOT NULL,
  source_id text NOT NULL,
  payload_sha256 bytea NOT NULL,
  signature_valid boolean NOT NULL,
  clock_trusted boolean NOT NULL,
  UNIQUE (device_id, boot_id, sequence)
);

CREATE TABLE observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id uuid NOT NULL REFERENCES telemetry_envelope(id),
  participant_id uuid REFERENCES participant(id),
  kind text NOT NULL,
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  coordinate geometry(PointZ, 4326),
  horizontal_accuracy_m double precision,
  value jsonb NOT NULL,
  quality text NOT NULL,
  gateway_id uuid REFERENCES gateway(id)
);

CREATE TABLE participant_state (
  participant_id uuid PRIMARY KEY REFERENCES participant(id),
  version bigint NOT NULL,
  coordinate geometry(PointZ, 4326),
  horizontal_accuracy_m double precision,
  location_source text NOT NULL,
  zone_id uuid REFERENCES zone(id),
  motion text,
  battery_percent integer CHECK (battery_percent BETWEEN 0 AND 100),
  connectivity text NOT NULL,
  alert_state text NOT NULL,
  last_observed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE alert (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid REFERENCES participant(id),
  rule_id text NOT NULL,
  severity alert_severity NOT NULL,
  status alert_status NOT NULL,
  reason_code text NOT NULL,
  opened_at timestamptz NOT NULL,
  acknowledged_at timestamptz,
  acknowledged_by text,
  resolved_at timestamptz,
  resolved_by text,
  resolution_reason text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  request_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX observation_participant_time
  ON observation (participant_id, observed_at DESC);
CREATE INDEX observation_coordinate_gist
  ON observation USING gist (coordinate);
CREATE INDEX zone_boundary_gist
  ON zone USING gist (boundary);
CREATE INDEX alert_open
  ON alert (status, severity, opened_at DESC);
```

Biometric observations use a dedicated database role and may be moved to a
separate partition/schema. Routine deletion operates on observation kind and
consent policy. Incident preservation records the alert/incident ID, authorizer,
reason, scope, and expiry; it never silently disables retention globally.

## 12. External APIs

### 12.1 HTTPS REST API

Base path: `/guardian/v1`

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| `POST` | `/telemetry:batch` | enrolled companion | Submit up to 100 envelopes |
| `POST` | `/devices:enroll` | administrator | Exchange one-time enrollment proof |
| `POST` | `/devices/{id}:revoke` | administrator | Revoke device and sessions |
| `GET` | `/participants` | supervisor | Current roster and state |
| `GET` | `/participants/{id}/timeline` | supervisor/history | Bounded timeline |
| `POST` | `/participants/{id}/check-ins` | participant/supervisor | Record check-in |
| `GET` | `/alerts` | supervisor | Filter active/history alerts |
| `POST` | `/alerts/{id}:acknowledge` | supervisor | Acknowledge with idempotency key |
| `POST` | `/alerts/{id}:resolve` | supervisor | Resolve with reason |
| `GET` | `/gateways` | supervisor | Health and last contact |
| `GET` | `/changes?cursor=` | field client | Ordered Guardian change feed |
| `POST` | `/retention/holds` | privacy administrator | Preserve incident scope |

Every mutation requires `Idempotency-Key`; responses include `request_id`,
`server_time`, and the resulting entity version. List endpoints use opaque
cursors and bounded page sizes. Exact location/history responses set
`Cache-Control: no-store`.

### 12.2 Internal gRPC API

```proto
service GuardianIngest {
  rpc StreamTelemetry(stream IngestFrame) returns (stream IngestReceipt);
}

service GuardianQuery {
  rpc GetParticipantState(GetParticipantStateRequest)
      returns (ParticipantState);
  rpc WatchState(WatchStateRequest) returns (stream StateChange);
  rpc WatchAlerts(WatchAlertsRequest) returns (stream AlertChange);
}
```

gRPC is internal to the service network and requires workload mTLS. Mobile
clients use the HTTPS API through the existing native certificate boundary.

### 12.3 Authorization roles

| Role | Location | Biometrics | Alerts | Configuration |
| --- | --- | --- | --- | --- |
| Participant | Own/current | Own/current | Initiate/cancel own SOS | No |
| Guardian | Assigned participant | Optional grant | View/acknowledge | Check-in policy |
| Supervisor | Property current | No | View/acknowledge/resolve | Operational |
| Medical | Incident/assigned | Explicit grant | View/acknowledge | No |
| Privacy administrator | Metadata | No by default | Audit | Consent/retention |
| Al | De-identified read-only | No raw values | Suggest only | No |

Guardian access to a minor is an explicit assignment, not inferred from a
shared property membership.

## 13. Deployment

### 13.1 Property deployment

```text
                    Tailscale / property LAN
                              |
                       reverse proxy (TLS)
                              |
             +----------------+----------------+
             |                |                |
       Guardian API      AetherTAK Field API  TAK Server
             |                |                |
             +-------- Guardian workers -------+
                              |
                     private service network
             +----------------+----------------+
             |                |                |
        PostgreSQL         Redis           MQTT broker
          + PostGIS
             |
      encrypted local backup target

 BLE gateways ---- TLS MQTT ----+
 Meshtastic bridge - TLS MQTT --+
 ChirpStack -------- local MQTT -+ (separate ACL/topic namespace)
```

The Pi can host a prototype and property pilot. Production readiness requires
measured CPU, memory, disk, database write load, restore time, and power-loss
behavior. A UPS and graceful shutdown are required. Services restart
automatically but alert state is recovered from PostgreSQL, not Redis.

### 13.2 Container boundaries

Recommended deployable units:

- `guardian-api`
- `guardian-ingest-worker`
- `guardian-fusion-worker`
- `guardian-rule-worker`
- `guardian-tak-publisher`
- `guardian-meshtastic-bridge`
- `guardian-retention-worker`
- `mosquitto`
- `postgres-postgis`
- `redis`

Use pinned image digests, read-only root filesystems where practical, non-root
UIDs, health checks, resource limits, and secrets mounted from the host secret
store. Databases and broker listeners are not exposed to the public Internet.

### 13.3 Availability modes

| Mode | Available behavior |
| --- | --- |
| Normal | Full telemetry, alerts, TAK, dashboard, and history |
| Internet lost | Property LAN continues; remote operators unavailable |
| Wi-Fi lost | Direct BLE gateway queues; Meshtastic fallback continues |
| TAK unavailable | Guardian alerts/dashboard continue; CoT outbox retries |
| Database unavailable | Gateways queue; no new authoritative alert decisions |
| Pi power loss | Wearable SOS/local feedback and Meshtastic peer messaging only |

The UI must distinguish all modes. “Connected to mesh” must never be presented
as “Guardian alert delivered.”

## 14. Security controls

- Offline root CA; separate issuing CAs for clients, gateways, and services
- Short-lived service certificates and revocation
- Unique per-device signing keys; no fleet-wide device secret
- Secure boot and signed firmware on Castalia-controlled hardware
- Enrollment requiring physical possession and a one-time QR/code
- TLS 1.2+ with server validation; TLS 1.3 preferred
- LE Secure Connections and bonded allow-list for direct BLE
- Private Meshtastic channel with unique PSK and controlled distribution
- Sequence/boot replay defense and command nonce/expiry
- Input size, depth, rate, coordinate, and XML bounds
- Database encryption at rest plus encrypted, tested backups
- No secrets or sensitive values in metrics/logs
- Append-only audit events for enrollment, access, acknowledgement, resolution,
  geofence changes, consent, retention holds, and export

Threat-model reviews must cover lost wearables, cloned gateway identities,
malicious MQTT publication, compromised supervisor devices, replayed SOS,
location stalking, overbroad TAK groups, and insider history access.

## 15. Privacy and retention

Defaults for a pilot:

| Data | Suggested default | Notes |
| --- | --- | --- |
| Raw location/motion | 24 hours | Configurable per program and consent |
| Raw biometric context | 1 hour | Disabled unless explicitly enabled |
| Fused state transitions | 7 days | Coarser than raw samples |
| Resolved alert metadata | 90 days | Minimize location snapshot |
| Routine audit events | 1 year | No raw telemetry in audit detail |
| Gateway health | 30 days | No participant identity |
| Preserved incident | Explicit expiry | Authorized, scoped, and auditable |

These are engineering defaults, not legal conclusions. Policy owners must
approve final values for the jurisdiction and participant population.

Exports are purpose-specific, encrypted, watermarked with request/audit IDs,
and exclude unrelated participants.

## 16. Observability

Metrics:

- Envelopes accepted/rejected/duplicated by transport and reason
- Ingest-to-state and state-to-TAK latency histograms
- Active/stale/lost participants by property, without identity labels
- Gateway last contact, queue depth, battery, reboot, and clock skew
- Meshtastic hop count, duplicate rate, and delivery receipt rate
- MQTT connection and publish failures
- Rule candidate/active/acknowledged/resolved counts
- TAK outbox depth and oldest age
- Retention deletion and hold counts

Alerts on the platform itself must be clearly separate from participant safety
alerts. Metrics labels may use opaque IDs, never display names.

## 17. Acceptance criteria

### 17.1 Functional

- One stable TAK marker per participant across device and transport handoffs
- GPS, single-gateway presence, Meshtastic, and last-known states show distinct
  source and uncertainty
- Green/yellow/red transitions honor dwell and hysteresis
- SOS is delivered, acknowledged, cancelled, and audited idempotently
- Device separation, missed check-in, low battery, and telemetry loss operate
  under simulated time
- AetherTAK Field renders participant state offline after prior sync
- Current iTAK and ATAK render standard PLI even if they ignore Guardian detail
- Biometrics are absent from the general TAK stream and non-medical API roles

### 17.2 Performance pilot targets

- Wi-Fi ingest-to-dashboard p95 under 5 seconds
- Wi-Fi ingest-to-TAK p95 under 10 seconds
- Direct BLE observation-to-ingest p95 under 15 seconds
- Meshtastic fallback latency reported separately; no fixed safety guarantee
- 100 participants at 15-second active cadence without queue growth
- Seven days of property operation within measured storage budget

### 17.3 Resilience

- Broker restart loses no acknowledged ingress
- Worker restart produces the same fused state from replay
- TAK outage does not block Guardian alert evaluation
- Duplicate gateway and mesh delivery creates one observation
- Power-cycle recovery passes with corrupted partial-write simulation
- Backup restore is exercised and timed before a pilot

### 17.4 Physical validation

- Active 2 with paired phone: foreground GPS, background limitations, heart
  rate permission, SOS, queue recovery, phone separation, and battery profile
- Direct wearable: property-wide BLE handoff, queueing, removal, SOS, and
  gateway loss
- Meshtastic: trail coverage, hop/latency distribution, duplicate bridges,
  private-channel configuration, and fallback recovery
- AetherTAK Field on physical iOS and Android
- Bidirectional marker/emergency behavior with released iTAK and ATAK

## 18. Work breakdown

### Phase G0: Safety and feasibility

- Approve consent, retention, alert ownership, and field response procedures
- Measure Active 2 API level and behavior on physical hardware
- Select direct wearable hardware for phone-free participants
- Survey BLE, Wi-Fi, and Meshtastic property coverage
- Produce threat model and misuse cases

### Phase G1: Vertical slice

- Add protobuf package and golden test vectors
- Implement one direct wearable or simulator
- Implement one BLE gateway
- Deploy broker, ingest, core schema, fusion, and TAK publisher
- Render one participant marker with source/uncertainty in AetherTAK Field

### Phase G2: Safety workflow

- Zones, dwell/hysteresis, check-ins, SOS, acknowledgement, and resolution
- Supervisor roster and alert queue
- Gateway health and lost-telemetry behavior
- Audit and retention jobs

### Phase G3: Companion and mesh

- Zepp Device App and Side Service
- Meshtastic bridge with private-channel deployment
- Transport handoff, deduplication, and queue recovery

### Phase G4: Pilot hardening

- Load, chaos, restore, battery, and coverage testing
- iTAK/ATAK interoperability evidence
- Security review and privacy review
- Written property response procedures and participant training

## 19. Repository boundaries

Suggested repositories/packages:

```text
AetherTAK-Field/
  Guardian mobile views, offline state, TAK rendering, physical validation

AetherTAK/
  TAK server deployment, field/Guardian mTLS API, CoT publication integration

Castalia-Guardian/
  services/
  proto/
  firmware/gateway/
  firmware/wearable/
  zepp/
  deploy/
  migrations/
  tests/
```

Until `Castalia-Guardian` exists, this document is the contract. Shared
protobuf, CoT fixtures, and database migrations should have one owning
repository and be consumed by version; do not copy divergent schemas between
projects.

## 20. Primary references

- Zepp OS architecture:
  <https://docs.zepp.com/docs/guides/architecture/arc/>
- Zepp OS App Service limitations:
  <https://docs.zepp.com/docs/guides/framework/device/app-service/>
- Zepp OS BLE API:
  <https://docs.zepp.com/docs/v2/reference/device-app-api/newAPI/ble/>
- Zepp OS heart-rate API:
  <https://docs.zepp.com/docs/v2/reference/device-app-api/newAPI/sensor/HeartRate/>
- Meshtastic MQTT integration:
  <https://meshtastic.org/docs/software/integrations/mqtt/>
- Meshtastic channel configuration:
  <https://meshtastic.org/docs/configuration/radio/channels/>
- Meshtastic Python Client API:
  <https://python.meshtastic.org/>
- ChirpStack v4 MQTT integration:
  <https://www.chirpstack.io/docs/chirpstack/integrations/mqtt.html>
- ChirpStack v4 gRPC API:
  <https://www.chirpstack.io/docs/chirpstack/api/grpc.html>
- AetherTAK Field TAK interoperability:
  [tak-interoperability.md](tak-interoperability.md)
- AetherTAK Field native plugin boundary:
  [native-plugins.md](native-plugins.md)
