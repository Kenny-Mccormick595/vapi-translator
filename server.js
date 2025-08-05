const express = require('express');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/translate', async (req, res) => {
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