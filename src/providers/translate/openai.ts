import OpenAI from 'openai';

export interface OpenAITranslateConfig {
  apiKey: string;
  model: string; // e.g., 'gpt-4o-mini'
  systemPrompt?: string;
}

export class OpenAITranslator {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly system: string;

  constructor(cfg: OpenAITranslateConfig) {
    this.client = new OpenAI({ apiKey: cfg.apiKey });
    this.model = cfg.model;
    this.system = cfg.systemPrompt || 'Translate from Hebrew to English. Respond only with the translation.';
  }

  async translate(text: string): Promise<string> {
    if (!text.trim()) return '';
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: this.system },
        { role: 'user', content: text },
      ],
      temperature: 0,
    });
    return res.choices?.[0]?.message?.content?.trim() || '';
  }
}
