package com.fips.termuxwrapper

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    private lateinit var npubInput: EditText
    private lateinit var waitInput: EditText
    private lateinit var statusText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        npubInput = findViewById(R.id.npubInput)
        waitInput = findViewById(R.id.waitInput)
        statusText = findViewById(R.id.statusText)

        findViewById<Button>(R.id.runButton).setOnClickListener {
            runTermuxCommand()
        }
    }

    private fun runTermuxCommand() {
        val npub = npubInput.text?.toString()?.trim().orEmpty()
        val waitMs = waitInput.text?.toString()?.trim().ifBlank { "60000" }

        if (!npub.startsWith("npub")) {
            statusText.text = "Status: invalid npub"
            return
        }

        val scriptPath = "/data/data/com.termux/files/home/fips-nostr-bootstrap/apps/fips-pty-client.mjs"
        val executable = "/data/data/com.termux/files/usr/bin/node"

        val args = arrayOf(scriptPath, "--npub", npub, "--wait", waitMs)

        val intent = Intent().apply {
            setClassName("com.termux", "com.termux.app.RunCommandService")
            action = "com.termux.RUN_COMMAND"
            putExtra("com.termux.RUN_COMMAND_PATH", executable)
            putExtra("com.termux.RUN_COMMAND_ARGUMENTS", args)
            putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home/fips-nostr-bootstrap")
            putExtra("com.termux.RUN_COMMAND_BACKGROUND", false)
            putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0")
        }

        try {
            startService(intent)
            statusText.text = "Status: launched in Termux"
        } catch (e: Exception) {
            statusText.text = "Status: failed (${e.message})"
            // Fallback: open Termux app page
            val fallback = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.termux"))
            runCatching { startActivity(fallback) }
        }
    }
}
