import 'package:flutter/material.dart';

void main() {
  runApp(const FaceVidMobileApp());
}

class FaceVidMobileApp extends StatelessWidget {
  const FaceVidMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'FACE VID',
      theme: ThemeData(
        scaffoldBackgroundColor: const Color(0xFF080B12),
        primaryColor: const Color(0xFF356DFF),
      ),
      home: Scaffold(
        appBar: AppBar(
          backgroundColor: const Color(0xFF080B12),
          title: Image.asset(
            'assets/owner/face-vid-official-logo.png',
            fit: BoxFit.contain,
            height: 36,
          ),
        ),
        body: const Center(
          child: Text(
            'FACE VID Mobile Foundation',
            style: TextStyle(color: Colors.white),
          ),
        ),
      ),
    );
  }
}
