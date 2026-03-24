import 'dart:convert';
import 'rust/frb_generated.dart';
Future<String> apiBootstrap({required String relayUrl, required String serverNpub, required int timeoutMs, required bool connectMode}) async {
  try {
    final r = await RustLib.instance.api.bootstrap(relayUrl: relayUrl, serverNpub: serverNpub, timeoutMs: timeoutMs, connectMode: connectMode);
    return const JsonEncoder.withIndent('  ').convert(r.toJson());
  } catch (e) {
    return jsonEncode({'error': e.toString()});
  }
}
Future<String> apiEchoTest({required String relayUrl, required String serverNpub, required int timeoutMs}) async {
  try {
    final r = await RustLib.instance.api.echoTest(relayUrl: relayUrl, serverNpub: serverNpub, timeoutMs: timeoutMs);
    return const JsonEncoder.withIndent('  ').convert(r.toJson());
  } catch (e) {
    return jsonEncode({'error': e.toString()});
  }
}
