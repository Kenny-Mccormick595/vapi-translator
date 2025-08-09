const express = require('express');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Basic health and validation endpoints so external services (like Vapi) can verify the server URL
app.get('/', (_req, res) => {
  res.status(200).send('OK');
});

app.head('/', (_req, res) => {
  res.sendStatus(200);
});

// Generic webhook receiver; responds 200 to acknowledge receipt during validation
app.post('/', (req, res) => {
  // Optionally log for debugging
  try {
    console.log('Inbound webhook received at / with headers:', req.headers);
    if (req.body) {
      console.log('Body:', JSON.stringify(req.body));
    }
  } catch (_) {
    // ignore logging errors
  }
  res.status(200).json({ received: true });
});

// Dedicated webhook path in case you want to set a specific URL in Vapi
app.get('/webhook', (_req, res) => {
  res.status(200).send('OK');
});

app.head('/webhook', (_req, res) => {
  res.sendStatus(200);
});

app.post('/webhook', (req, res) => {
  try {
    console.log('Inbound webhook received at /webhook with headers:', req.headers);
    if (req.body) {
      console.log('Body:', JSON.stringify(req.body));
    }
  } catch (_) {}
  res.status(200).json({ received: true });
});

app.post('/translate', express.json(), async (req, res) => {
  const { transcript } = req.body;
  if (!transcript) {
    return res.status(400).json({ error: 'Transcript is required' });
  }
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Translate from Hebrew to English. Respond only with the translation.' },
        { role: 'user', content: transcript }
      ]
    });
    const translated = completion.choices[0].message.content;
    res.json({ text: translated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Translation failed' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`)); 