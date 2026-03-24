// The original content is temporarily commented out to allow generating a self-contained demo - feel free to uncomment later.

// import 'dart:convert';
// import 'package:flutter/material.dart';
// import 'src/bridge.dart';
// 
// void main() => runApp(const FipsApp());
// 
// class FipsApp extends StatelessWidget {
//   const FipsApp({super.key});
//   @override Widget build(BuildContext c) => MaterialApp(
//     title: 'FIPS Mobile',
//     theme: ThemeData(
//       colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepOrange),
//       useMaterial3: true,
//     ),
//     home: const BootstrapScreen(),
//   );
// }
// 
// class BootstrapScreen extends StatefulWidget {
//   const BootstrapScreen({super.key});
//   @override State<BootstrapScreen> createState() => _BootstrapScreenState();
// }
// 
// class _BootstrapScreenState extends State<BootstrapScreen> {
//   final relay = TextEditingController(text: 'wss://fips.tomdwyer.uk');
//   final npub = TextEditingController(text: 'npub1ns6n8tsget5ezzrwj7es8hvn69yu2s5fcpq8xsutqgm5eddtjpes3n0kgq');
//   String output = 'Ready';
//   String ping = '-';
//   String echo = '-';
//   bool busy = false;
// 
//   Future<void> _bootstrap() async {
//     setState(() {
//       busy = true;
//       output = 'Bootstrapping...';
//     });
//     final raw = await apiBootstrap(
//       relayUrl: relay.text,
//       serverNpub: npub.text,
//       timeoutMs: 20000,
//       connectMode: false,
//     );
//     _handleResult(raw, 'bootstrapRttMs');
//   }
// 
//   Future<void> _echo() async {
//     setState(() {
//       busy = true;
//       echo = 'Running...';
//       output = 'Running echo test...';
//     });
//     final raw = await apiEchoTest(
//       relayUrl: relay.text,
//       serverNpub: npub.text,
//       timeoutMs: 25000,
//     );
//     _handleResult(raw, 'echoRttMs', isEcho: true);
//   }
// 
//   void _handleResult(String raw, String rttKey, {bool isEcho = false}) {
//     try {
//       final json = jsonDecode(raw) as Map<String, dynamic>;
//       if (json.containsKey('error')) {
//         setState(() {
//           output = 'Error: ${json['error']}';
//           if (isEcho) echo = 'Failed';
//           busy = false;
//         });
//         return;
//       }
//       final rtt = json[rttKey];
//       final rttStr = rtt != null ? '$rtt ms' : '-';
//       setState(() {
//         output = const JsonEncoder.withIndent('  ').convert(json);
//         if (isEcho) {
//           ping = '-'; // clear ping on echo run (optional)
//           echo = (json['echoRoundtripOk'] == true) ? 'OK $rttStr' : 'Failed';
//         } else {
//           ping = rttStr;
//         }
//         busy = false;
//       });
//     } catch (e) {
//       setState(() {
//         output = 'Parse error: $e\nRaw: $raw';
//         if (isEcho) echo = 'Failed';
//         busy = false;
//       });
//     }
//   }
// 
//   void _copyOutput() {
//     // Use Clipboard.setData (requires import) but to avoid dependency on services, we can use a simple approach:
//     // In a real app: import 'package:flutter/services.dart'; Clipboard.setData(ClipboardData(text: output));
//     // For now, skip to keep dependencies minimal; user can manually copy from selectable text.
//   }
// 
//   @override
//   Widget build(BuildContext context) {
//     final colors = Theme.of(context).colorScheme;
//     return Scaffold(
//       appBar: AppBar(
//         title: const Text('FIPS Mobile'),
//         actions: [
//           IconButton(
//             icon: const Icon(Icons.copy),
//             onPressed: busy ? null : _copyOutput,
//             tooltip: 'Copy output',
//           ),
//         ],
//       ),
//       body: Padding(
//         padding: const EdgeInsets.all(16),
//         child: Column(
//           children: [
//             TextField(
//               controller: relay,
//               decoration: const InputDecoration(
//                 labelText: 'Relay URL',
//                 border: OutlineInputBorder(),
//                 isDense: true,
//               ),
//             ),
//             const SizedBox(height: 12),
//             TextField(
//               controller: npub,
//               decoration: const InputDecoration(
//                 labelText: 'Server NPUB',
//                 border: OutlineInputBorder(),
//                 isDense: true,
//               ),
//             ),
//             const SizedBox(height: 16),
//             Row(
//               children: [
//                 Expanded(
//                   child: Card(
//                     elevation: 2,
//                     child: Padding(
//                       padding: const EdgeInsets.all(12),
//                       child: Row(
//                         mainAxisSize: MainAxisSize.min,
//                         children: [
//                           Icon(Icons.timer, color: colors.primary, size: 20),
//                           const SizedBox(width: 8),
//                           Flexible(
//                             child: Text('Bootstrap RTT: $ping',
//                                 style: Theme.of(context).textTheme.titleMedium),
//                           ),
//                         ],
//                       ),
//                     ),
//                   ),
//                 ),
//                 const SizedBox(width: 8),
//                 Expanded(
//                   child: Card(
//                     elevation: 2,
//                     child: Padding(
//                       padding: const EdgeInsets.all(12),
//                       child: Row(
//                         mainAxisSize: MainAxisSize.min,
//                         children: [
//                           Icon(Icons.swap_horiz, color: colors.secondary, size: 20),
//                           const SizedBox(width: 8),
//                           Flexible(
//                             child: Text('Echo: $echo',
//                                 style: Theme.of(context).textTheme.titleMedium),
//                           ),
//                         ],
//                       ),
//                     ),
//                   ),
//                 ),
//               ],
//             ),
//             const SizedBox(height: 16),
//             Row(
//               children: [
//                 Expanded(
//                   child: FilledButton.icon(
//                     onPressed: busy ? null : _bootstrap,
//                     icon: busy
//                         ? const SizedBox(
//                             width: 16,
//                             height: 16,
//                             child: CircularProgressIndicator(strokeWidth: 2),
//                           )
//                         : const Icon(Icons.play_arrow),
//                     label: Text(busy ? 'Running...' : 'Bootstrap'),
//                   ),
//                 ),
//                 const SizedBox(width: 8),
//                 Expanded(
//                   child: OutlinedButton.icon(
//                     onPressed: busy ? null : _echo,
//                     icon: const Icon(Icons.refresh),
//                     label: const Text('Echo Test'),
//                   ),
//                 ),
//               ],
//             ),
//             const SizedBox(height: 16),
//             const Align(
//                 alignment: Alignment.centerLeft,
//                 child: Text('Output:', style: TextStyle(fontWeight: FontWeight.bold))),
//             const SizedBox(height: 8),
//             Expanded(
//               child: Container(
//                 decoration: BoxDecoration(
//                   color: Theme.of(context).colorScheme.surfaceContainerHighest,
//                   borderRadius: BorderRadius.circular(8),
//                 ),
//                 padding: const EdgeInsets.all(12),
//                 child: SingleChildScrollView(
//                   child: SelectableText(
//                     output,
//                     style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
//                   ),
//                 ),
//               ),
//             ),
//           ],
//         ),
//       ),
//     );
//   }
// }
// 

import 'package:flutter/material.dart';
import 'package:flutter_fips_client/src/rust/api/simple.dart';
import 'package:flutter_fips_client/src/rust/frb_generated.dart';

Future<void> main() async {
  await RustLib.init();
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        appBar: AppBar(title: const Text('flutter_rust_bridge quickstart')),
        body: Center(
          child: Text(
              'Action: Call Rust `greet("Tom")`\nResult: `${greet(name: "Tom")}`'),
        ),
      ),
    );
  }
}
