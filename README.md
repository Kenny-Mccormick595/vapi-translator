# Vapi Translator

A Node.js webhook server that translates Hebrew speech transcripts to English using OpenAI's GPT-4o model. Designed for integration with Vapi AI voice agents.

## Features

- **Hebrew to English Translation**: Uses OpenAI's GPT-4o model for accurate translations
- **Simple REST API**: Single POST endpoint for translation requests
- **Error Handling**: Proper error responses for invalid requests
- **Environment Configuration**: Secure API key management

## API Endpoint

### POST `/translate`

Translates Hebrew text to English.

**Request Body:**
```json
{
  "transcript": "שלום עולם"
}
```

**Response:**
```json
{
  "text": "Hello world"
}
```

**Error Response:**
```json
{
  "error": "Transcript is required"
}
```

## Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/vapi-translator.git
   cd vapi-translator
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   Create a `.env` file in the root directory:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   ```

4. **Start the server:**
   ```bash
   npm start
   ```

The server will run on `http://localhost:3000` by default.

## Deployment

This project includes a `render.yaml` file for easy deployment on Render.com:

1. Push your code to GitHub
2. Connect your repository to Render
3. Set the `OPENAI_API_KEY` environment variable in Render dashboard
4. Deploy!

## Usage Examples

### Using curl:
```bash
curl -X POST http://localhost:3000/translate \
  -H "Content-Type: application/json" \
  -d '{"transcript": "שלום עולם"}'
```

### Using JavaScript:
```javascript
const response = await fetch('http://localhost:3000/translate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    transcript: 'שלום עולם'
  })
});

const result = await response.json();
console.log(result.text); // "Hello world"
```

## Environment Variables

- `OPENAI_API_KEY` (required): Your OpenAI API key
- `PORT` (optional): Server port (default: 3000)

## Dependencies

- `express`: Web framework
- `openai`: OpenAI API client
- `dotenv`: Environment variable management

## License

MIT 