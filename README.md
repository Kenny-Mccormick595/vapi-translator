# Vapi Translator

A Node.js webhook server that translates Hebrew speech transcripts to English using OpenAI's GPT-4o model. Designed for integration with Vapi AI voice agents.

## 🚀 Features

- **Hebrew to English Translation**: Uses OpenAI's GPT-4o model for accurate translations
- **Simple REST API**: Single POST endpoint for translation requests
- **Error Handling**: Proper error responses for invalid requests
- **Environment Configuration**: Secure API key management
- **Ready for Deployment**: Includes Render.com configuration

## 📋 API Endpoint

### POST `/translate`

Translates Hebrew text to English.

**Request Body:**
```json
{
  "transcript": "שלום עולם"
}
```

**Success Response:**
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

## 🛠️ Setup

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- OpenAI API key

### Local Development

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
   ```env
   OPENAI_API_KEY=your_openai_api_key_here
   PORT=3000
   ```

4. **Start the server:**
   ```bash
   npm start
   ```

The server will run on `http://localhost:3000` by default.

## 🚀 Deployment

### Render.com (Recommended)

This project includes a `render.yaml` file for easy deployment:

1. **Push your code to GitHub**
2. **Connect to Render:**
   - Go to [render.com](https://render.com)
   - Click "New" → "Blueprint"
   - Select your repository
3. **Set environment variables:**
   - Add `OPENAI_API_KEY` with your OpenAI API key
4. **Deploy!**

Your service will be available at `https://your-app-name.onrender.com`

### Other Platforms

The app can be deployed to any Node.js hosting platform:
- **Heroku**: Add `Procfile` with `web: npm start`
- **Vercel**: Add `vercel.json` configuration
- **Railway**: Direct deployment from GitHub

## 💻 Usage Examples

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

### Using Python:
```python
import requests

response = requests.post(
    'http://localhost:3000/translate',
    json={'transcript': 'שלום עולם'},
    headers={'Content-Type': 'application/json'}
)

result = response.json()
print(result['text'])  # "Hello world"
```

## 🔧 Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `OPENAI_API_KEY` | ✅ | Your OpenAI API key | - |
| `PORT` | ❌ | Server port | `3000` |

## 📦 Dependencies

- **express**: Web framework for Node.js
- **openai**: Official OpenAI API client
- **dotenv**: Environment variable management

## 🔒 Security

- API keys are stored in environment variables
- `.env` files are excluded from version control
- Input validation prevents malicious requests

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

If you encounter any issues:
1. Check that your OpenAI API key is valid
2. Ensure all environment variables are set correctly
3. Verify the server is running on the correct port
4. Check the server logs for error messages

---

**Built with ❤️ for Vapi AI voice agents** 