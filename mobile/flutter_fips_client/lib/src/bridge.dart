import 'dart:convert';
import 'rust/api.dart' as api;

Map<String, dynamic> _endpoint(api.Endpoint e) => {'host': e.host, 'port': e.port};
Map<String, dynamic> _punch(api.Punch p) => {
      'startAtMs': p.startAtMs,
      'intervalMs': p.intervalMs.toInt(),
      'durationMs': p.durationMs.toInt(),
    };
Map<String, dynamic> _stun(api.StunInfo s) => {'uri': s.uri, 'metadataTag': s.metadataTag};

Map<String, dynamic> _serverInfo(api.ServerInfo s) => {
      'type': s.msgType,
      'version': s.version,
      'sessionId': s.sessionId,
      'nonce': s.nonce,
      'issuedAt': s.issuedAt,
      'endpoint': _endpoint(s.endpoint),
      'punch': s.punch == null ? null : _punch(s.punch!),
      'stun': s.stun == null ? null : _stun(s.stun!),
    };

Future<String> apiBootstrap({
  required String relayUrl,
  required String serverNpub,
  required int timeoutMs,
  required bool connectMode,
}) async {
  try {
    final r = await api.bootstrap(
      relayUrl: relayUrl,
      serverNpub: serverNpub,
      timeoutMs: timeoutMs,
      connectMode: connectMode,
    );
    final json = {
      'bootstrapRttMs': r.bootstrapRttMs,
      'relayUrl': r.relayUrl,
      'serverNpub': r.serverNpub,
      'clientNpub': r.clientNpub,
      'serverInfo': _serverInfo(r.serverInfo),
    };
    return const JsonEncoder.withIndent('  ').convert(json);
  } catch (e) {
    return jsonEncode({'error': e.toString()});
  }
}

Future<String> apiEchoTest({
  required String relayUrl,
  required String serverNpub,
  required int timeoutMs,
}) async {
  try {
    final r = await api.echoTest(
      relayUrl: relayUrl,
      serverNpub: serverNpub,
      timeoutMs: timeoutMs,
    );
    final json = {
      'echoRoundtripOk': r.echoRoundtripOk,
      'echoRttMs': r.echoRttMs,
      'endpoint': _endpoint(r.endpoint),
      'detail': r.detail,
    };
    return const JsonEncoder.withIndent('  ').convert(json);
  } catch (e) {
    return jsonEncode({'error': e.toString()});
  }
}
