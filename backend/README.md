# Guided Translator Backend

Python FastAPI backend for the Guided Translator desktop application.

## Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## Run Development Server

```bash
uvicorn main:app --reload --port 8000
```

## API Endpoints

### Document Parsing
- `POST /api/parse/pdf` - Parse PDF using MinerU Cloud API
- `POST /api/parse/markdown` - Parse markdown file

### Translation
- `POST /api/translate/chunk` - Translate a single chunk
- `POST /api/translate/batch` - Batch translate with SSE streaming

### API Keys
- `POST /api/keys` - Set API keys (Gemini, MinerU)
- `GET /api/keys/status` - Check which keys are configured

## Environment Variables

Create a `.env` file:
```
GEMINI_API_KEY=your_gemini_key
MINERU_API_KEY=your_mineru_key
```
