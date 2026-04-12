const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_MODEL = 'mistral-small-2506';

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, max_tokens, system, temperature, top_p } = req.body;

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
        'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
      },
      body: JSON.stringify(mistralBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Mistral API error (${response.status}):`, errorText);
      return res.status(response.status).json({
        content: [],
        error: { message: errorText },
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
