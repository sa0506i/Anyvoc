const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// --- Startup validation ---
if (!process.env.MISTRAL_API_KEY) {
  console.error('FATAL: MISTRAL_API_KEY environment variable is not set');
  process.exit(1);
}

const app = express();

// --- Trust proxy: Fly.dev puts exactly one reverse proxy (Fly Edge) in
// front of this Node app, so X-Forwarded-For carries the real client IP.
// Without this, req.ip returns the Fly-internal proxy IP (identical for
// every request) and express-rate-limit buckets ALL traffic globally
// instead of per user — a 60/min limit that should be per-IP instead
// throttles the whole backend worldwide.
// Value `1` = trust exactly one hop; do NOT use `true` (would trust the
// whole X-Forwarded-For chain, which is spoofable by any client). If Fly
// ever chains multiple proxies, raise to the hop count, never blanket-true.
app.set('trust proxy', 1);

// --- CORS: restrict to expected origins ---
// React Native fetch doesn't send an Origin header, so CORS mainly
// gates browser clients (Expo web in dev). In production we accept
// only the native app's URL scheme; in dev we additionally allow
// Metro's default port on localhost and the Android emulator bridge.
const isProduction = process.env.NODE_ENV === 'production';
app.use(
  cors({
    origin: isProduction
      ? [/^exp\+anyvoc:\/\//]
      : [/^exp\+anyvoc:\/\//, /^https?:\/\/localhost:8081$/, /^https?:\/\/10\.0\.2\.2:8081$/],
    methods: ['POST'],
  }),
);

app.use(express.json({ limit: '10mb' }));

// --- Per-message content size cap ---
// The 10 MB JSON limit stops binary bloat, but a client can still
// send many valid-shaped messages with pathologically long text and
// burn tokens. Cap each text content at 50 KB (~50k chars of UTF-8);
// images are base64 and bounded by the overall JSON limit.
const MAX_MESSAGE_CONTENT_BYTES = 50 * 1024;

function validateMessage(msg) {
  if (!msg || typeof msg !== 'object') return 'message must be an object';
  if (msg.role !== 'user' && msg.role !== 'assistant') {
    return 'message role must be "user" or "assistant"';
  }
  if (typeof msg.content === 'string') {
    if (Buffer.byteLength(msg.content, 'utf8') > MAX_MESSAGE_CONTENT_BYTES) {
      return `message content exceeds ${MAX_MESSAGE_CONTENT_BYTES} bytes`;
    }
    return null;
  }
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (!block || typeof block !== 'object') return 'content block must be an object';
      if (block.type === 'text') {
        if (typeof block.text !== 'string') return 'text block missing text';
        if (Buffer.byteLength(block.text, 'utf8') > MAX_MESSAGE_CONTENT_BYTES) {
          return `text block exceeds ${MAX_MESSAGE_CONTENT_BYTES} bytes`;
        }
      } else if (block.type === 'image') {
        if (
          !block.source ||
          block.source.type !== 'base64' ||
          typeof block.source.data !== 'string'
        ) {
          return 'image block malformed';
        }
      } else {
        return `unknown content block type: ${block.type}`;
      }
    }
    return null;
  }
  return 'message content must be string or array';
}

// --- Rate limiting: 120 requests per minute per IP ---
// Raised from 60 → 120 on 2026-04-23 alongside the trust-proxy fix: the
// previous 60/min was effectively a global bucket (see trust-proxy note
// above), so it never actually constrained per-user usage. With the fix
// the limit is now per-IP, and 120/min gives generous headroom for:
//  (a) normal app usage — a single user hitting the share flow or the
//      long-press translate pro-mode path can easily trigger 5-10 calls
//      in a burst (extraction chunking + classifier fallbacks).
//  (b) dev sweeps from a workstation (try-pipeline:parallel, concurrency≤6).
// If abuse is observed, halve this or add a second sliding window at the
// hour level.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { content: [], error: { message: 'Too many requests, please try again later.' } },
});

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_MODEL = 'mistral-small-2506';

function safeErrorMessage(status) {
  if (status === 401 || status === 403) return 'Authentication error. Please contact support.';
  if (status === 429) return 'Rate limit exceeded. Please try again shortly.';
  if (status >= 500) return 'Service temporarily unavailable. Please try again later.';
  if (status >= 400) return 'Request rejected. Please try again.';
  return `Upstream service error (${status}).`;
}

app.post('/api/chat', apiLimiter, async (req, res) => {
  try {
    const { messages, max_tokens, system, temperature, top_p } = req.body;

    // --- Request validation ---
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        content: [],
        error: { message: 'Invalid request: messages must be a non-empty array' },
      });
    }

    for (const msg of messages) {
      const err = validateMessage(msg);
      if (err) {
        return res.status(400).json({
          content: [],
          error: { message: `Invalid request: ${err}` },
        });
      }
    }

    if (
      max_tokens !== undefined &&
      (typeof max_tokens !== 'number' || max_tokens < 1 || max_tokens > 32768)
    ) {
      return res.status(400).json({
        content: [],
        error: { message: 'Invalid request: max_tokens must be a number between 1 and 32768' },
      });
    }

    // Transform Claude format → Mistral format
    // Claude sends system as a separate field; Mistral expects it as the first message
    const mistralMessages = [];
    if (system) {
      mistralMessages.push({ role: 'system', content: system });
    }
    mistralMessages.push(...messages);

    const mistralBody = {
      model: MISTRAL_MODEL,
      max_tokens,
      messages: mistralMessages,
    };

    if (temperature !== undefined) mistralBody.temperature = temperature;
    if (top_p !== undefined) mistralBody.top_p = top_p;

    const response = await fetch(MISTRAL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
      },
      body: JSON.stringify(mistralBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Mistral API error (${response.status}):`, errorText);
      // Never forward upstream error text to the client. Mistral's 401/5xx
      // bodies can include API key fragments, internal URLs, and other
      // provider-side details. Map to generic English strings and keep
      // the raw body only in server logs.
      return res.status(response.status).json({
        content: [],
        error: { message: safeErrorMessage(response.status) },
      });
    }

    const data = await response.json();

    // Transform Mistral response → Claude format
    // Mistral: { choices: [{ message: { content: "..." } }] }
    // Claude:  { content: [{ type: "text", text: "..." }] }
    const text = data.choices?.[0]?.message?.content || '';
    res.json({
      content: [{ type: 'text', text }],
    });
  } catch (error) {
    console.error('Mistral proxy error:', error);
    res.status(500).json({
      content: [],
      error: { message: 'Internal server error' },
    });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
