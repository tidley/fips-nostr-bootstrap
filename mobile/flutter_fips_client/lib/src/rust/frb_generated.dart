class RustLib {
  RustLib._();
  static final instance = RustLib._();
  final api = Api();
}
class Api {
  Future<BootstrapResult> bootstrap({required String relayUrl, required String serverNpub, required int timeoutMs, required bool connectMode}) async => throw UnimplementedError('Run flutter_rust_bridge_codegen after adding Rust crate');
  Future<EchoResult> echoTest({required String relayUrl, required String serverNpub, required int timeoutMs}) async => throw UnimplementedError('Run flutter_rust_bridge_codegen after adding Rust crate');
}
class BootstrapResult { final Map<String,dynamic> _j; BootstrapResult(this._j); Map<String,dynamic> toJson()=>_j; }
class EchoResult { final Map<String,dynamic> _j; EchoResult(this._j); Map<String,dynamic> toJson()=>_j; }
