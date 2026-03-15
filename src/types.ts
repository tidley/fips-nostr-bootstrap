export type ProtocolVersion = '1.0';

export type MessageType =
  | 'bootstrap_announce'
  | 'bootstrap_ack'
  | 'connect_probe'
  | 'connect_confirm'
  | 'rekey'
  | 'retry_hint'
  | 'abort';

export type HandshakeState =
  | 'idle'
  | 'announced'
  | 'awaiting_ack'
  | 'acknowledged'
  | 'probing'
  | 'direct_established'
  | 'fallback_pending'
  | 'fallback_established'
  | 'failed'
  | 'closed';

export type TransportMode = 'udp_direct' | 'relay_assisted';

export interface EndpointHint {
  host: string;
  port: number;
  transport: 'udp';
  priority: number;
}

export interface MessageBase {
  protocolVersion: ProtocolVersion;
  messageType: MessageType;
  senderIdentity: string;
  recipientIdentity: string;
  sessionId: string;
  monotonicTimestamp: number;
  expiry: number;
  nonce: string;
  signature: string;
  correlationId?: string;
  parentId?: string;
}

export interface BootstrapAnnounce extends MessageBase {
  messageType: 'bootstrap_announce';
  capabilities: string[];
  candidateEndpoints: EndpointHint[];
  ephemeralHandshakeMaterial: string;
}

export interface BootstrapAck extends MessageBase {
  messageType: 'bootstrap_ack';
  selectedTransportMode: TransportMode;
  candidateEndpoints: EndpointHint[];
  ephemeralHandshakeMaterial: string;
  punchWindowMs: number;
}

export interface ConnectProbe extends MessageBase {
  messageType: 'connect_probe';
  endpoint: EndpointHint;
  probeIndex: number;
}

export interface ConnectConfirm extends MessageBase {
  messageType: 'connect_confirm';
  selectedEndpoint: EndpointHint;
  negotiatedParameters: Record<string, string>;
}

export interface Rekey extends MessageBase {
  messageType: 'rekey';
  keyMaterial: string;
}

export interface RetryHint extends MessageBase {
  messageType: 'retry_hint';
  retryAfterMs: number;
  preferredCandidateOrder: string[];
}

export interface AbortMessage extends MessageBase {
  messageType: 'abort';
  reason: string;
}

export type SignalMessage =
  | BootstrapAnnounce
  | BootstrapAck
  | ConnectProbe
  | ConnectConfirm
  | Rekey
  | RetryHint
  | AbortMessage;

export interface SessionBinding {
  remoteIdentity: string;
  negotiatedParameters: Record<string, string>;
  selectedEndpointPair: { local: EndpointHint; remote: EndpointHint };
  sessionKeys: string;
}

export interface TransitionLog {
  at: number;
  from: HandshakeState;
  to: HandshakeState;
  event: MessageType | 'timeout' | 'probe_tick';
  reason?: string;
}

export interface TransitionResult {
  state: HandshakeState;
  accepted: boolean;
  reason?: string;
}
