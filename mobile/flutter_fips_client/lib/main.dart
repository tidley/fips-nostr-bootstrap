import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'src/bridge.dart';
import 'src/rust/frb_generated.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await RustLib.init();
  runApp(const FipsApp());
}

class FipsApp extends StatelessWidget {
  const FipsApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'FIPS Mobile',
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepOrange),
          useMaterial3: true,
        ),
        home: const BootstrapScreen(),
      );
}

class BootstrapScreen extends StatefulWidget {
  const BootstrapScreen({super.key});
  @override
  State<BootstrapScreen> createState() => _BootstrapScreenState();
}

class _BootstrapScreenState extends State<BootstrapScreen> {
  final relayCtl = TextEditingController(text: 'wss://fips.tomdwyer.uk');
  final npubCtl = TextEditingController(
      text: 'npub1ns6n8tsget5ezzrwj7es8hvn69yu2s5fcpq8xsutqgm5eddtjpes3n0kgq');

  String output = 'Ready';
  String pingLabel = '-';
  String echoLabel = '-';
  bool busy = false;

  Future<void> _bootstrap() async {
    setState(() {
      busy = true;
      output = 'Bootstrapping...';
    });
    final raw = await apiBootstrap(
      relayUrl: relayCtl.text.trim(),
      serverNpub: npubCtl.text.trim(),
      timeoutMs: 20000,
      connectMode: false,
    );
    _apply(raw, mode: 'bootstrap');
  }

  Future<void> _echo() async {
    setState(() {
      busy = true;
      echoLabel = 'Running...';
      output = 'Running echo test...';
    });
    final raw = await apiEchoTest(
      relayUrl: relayCtl.text.trim(),
      serverNpub: npubCtl.text.trim(),
      timeoutMs: 25000,
    );
    _apply(raw, mode: 'echo');
  }

  void _apply(String raw, {required String mode}) {
    try {
      final m = jsonDecode(raw) as Map<String, dynamic>;
      if (m.containsKey('error')) {
        setState(() {
          output = 'Error: ${m['error']}';
          if (mode == 'echo') echoLabel = 'Failed';
          busy = false;
        });
        return;
      }
      setState(() {
        output = const JsonEncoder.withIndent('  ').convert(m);
        if (mode == 'bootstrap') {
          final ms = m['bootstrapRttMs'];
          pingLabel = ms == null ? '-' : '${ms}ms';
        } else {
          final ok = m['echoRoundtripOk'] == true;
          echoLabel = ok ? 'OK ${m['echoRttMs'] ?? '-'}ms' : 'Failed';
        }
        busy = false;
      });
    } catch (e) {
      setState(() {
        output = 'Parse error: $e\nRaw: $raw';
        if (mode == 'echo') echoLabel = 'Failed';
        busy = false;
      });
    }
  }

  Future<void> _copyOutput() async {
    await Clipboard.setData(ClipboardData(text: output));
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(const SnackBar(content: Text('Output copied')));
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('FIPS Mobile'),
        actions: [
          IconButton(
            icon: const Icon(Icons.copy_all_outlined),
            onPressed: _copyOutput,
          )
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            TextField(
              controller: relayCtl,
              decoration: const InputDecoration(
                labelText: 'Relay URL',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: npubCtl,
              decoration: const InputDecoration(
                labelText: 'Server NPUB',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(children: [
                      Icon(Icons.speed, color: cs.primary),
                      const SizedBox(width: 8),
                      Expanded(child: Text('Bootstrap RTT: $pingLabel')),
                    ]),
                  ),
                ),
              ),
              Expanded(
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(children: [
                      Icon(Icons.wifi_tethering, color: cs.secondary),
                      const SizedBox(width: 8),
                      Expanded(child: Text('Echo: $echoLabel')),
                    ]),
                  ),
                ),
              ),
            ]),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: busy ? null : _bootstrap,
                    icon: busy
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.play_arrow),
                    label: Text(busy ? 'Working...' : 'Bootstrap'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: busy ? null : _echo,
                    icon: const Icon(Icons.sync),
                    label: const Text('Echo Test'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Expanded(
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(10),
                  color: cs.surfaceContainerHighest,
                ),
                child: SingleChildScrollView(
                  child: SelectableText(
                    output,
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 12.5),
                  ),
                ),
              ),
            )
          ],
        ),
      ),
    );
  }
}
