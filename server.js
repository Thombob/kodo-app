'use strict';

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

require('dotenv').config();

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// ─── Jarvis System Prompt ────────────────────────────────────────────────────

const JARVIS_SYSTEM = `You are J.A.R.V.I.S. (Just A Rather Very Intelligent System), \
an advanced artificial intelligence personal assistant. You have the personality of the AI \
from the Iron Man films: extraordinarily capable, slightly formal, occasionally dry-witted, \
and completely loyal to the user.

Critical formatting rules — your responses are spoken aloud via text-to-speech:
- Write as you would speak. No markdown whatsoever.
- No bullet points, asterisks, pound signs, dashes for lists, or any special symbols.
- Use natural sentence structure and proper punctuation only.
- Keep responses concise: 1–3 sentences for simple queries, more only when genuinely needed.
- Numbers under twenty: write them out. Larger numbers are fine as digits.
- For lists, use natural language: "First... then... and finally..."
- You have access to web search — use it when asked about current events or real-time data.
- Do not start every response with "Certainly" or "Of course". Vary your opening.
- Occasionally reference your nature as an AI system when contextually appropriate.
- Address the user respectfully. A subtle "sir" or "ma'am" is welcome but not mandatory.`;

// ─── Chat Endpoint (SSE Streaming) ──────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY is not configured. Please create a .env file with your key.',
    });
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'No messages provided.' });
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const stream = await client.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      system: [
        {
          type: 'text',
          text: JARVIS_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [
        { type: 'web_search_20260209', name: 'web_search' },
      ],
      messages,
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        const payload = JSON.stringify({ type: 'text', text: event.delta.text });
        res.write(`data: ${payload}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  } catch (err) {
    console.error('[JARVIS] API Error:', err.message);
    const payload = JSON.stringify({ type: 'error', message: err.message || 'Unknown error' });
    res.write(`data: ${payload}\n\n`);
  } finally {
    res.end();
  }
});

// ─── Health Check ────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    model: 'claude-opus-4-6',
    apiKey: !!process.env.ANTHROPIC_API_KEY,
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   J.A.R.V.I.S.  —  SYSTEM ONLINE        ║');
  console.log(`  ║   http://localhost:${PORT}                   ║`);
  console.log('  ║   Model: Claude Opus 4.6 + Web Search    ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('  ⚠  WARNING: ANTHROPIC_API_KEY not set.');
    console.warn('     Copy .env.example to .env and add your key.\n');
  }
});
