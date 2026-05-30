# Prospect Research Agent

This project is a web scraper and AI tool that builds company profiles for sales and marketing. Instead of spending hours doing manual research on prospects, you can use this agent to automatically pull the data you need from a target website.

## What It Does
When you provide a company URL, the system scrapes their website data. Then it uses the Google Gemini API to figure out their core services, target customers, and probable pain points. It also drafts a personalized outreach message based on that information.

## Tech Stack
* **Backend:** Python, FastAPI, BeautifulSoup4
* **AI Engine:** Google Gemini AI Pro
* **Frontend:** React, Vite
* **Batch Processing:** Google Colab

## Project Structure

```text
hackathon/
├── backend/          # FastAPI server
├── frontend/         # React SPA frontend
├── colab/            # Batch processing script
├── screenshots/      # Demo images
├── Procfile          # Railway/Heroku config
└── render.yaml       # Render.com config
```

## Local Setup

### Prerequisites
- Python 3.9+
- Node.js 18+
- Google Gemini API Key

### 1. Backend
Go to the project root, create a virtual environment, install the requirements and start the server:

```bash
# Create and activate virtual environment
python -m venv venv

# Windows
venv\Scripts\activate
# Mac/Linux
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env file for your API key
echo "GEMINI_API_KEY=your_gemini_api_key_here" > backend/.env

# Start FastAPI server
uvicorn backend.main:app --reload --port 8000
```
The backend will run on `http://localhost:8000`.

### 2. Frontend
Open a new terminal, go to the frontend folder, and start the Vite server:

```bash
cd frontend
npm install
npm run dev
```
The frontend will load at `http://localhost:5173`.

## API Reference

### POST /enrich
Takes a company URL and returns a structured data profile.
```json
{
  "url": "https://example.com"
}
```

### GET /results
Returns all saved company profiles.

## Colab Pipeline
If you want to process multiple URLs at once without using the UI:
1. Open up `colab/colab_notebook.ipynb` in Google Colab.
2. Put your API key in the `YOUR_GEMINI_API_KEY` placeholder.
3. Run all the cells and paste your target URLs when it asks for them.

## Deployment
This app is ready to deploy on standard PaaS platforms.
- **Railway/Heroku:** Uses the `Procfile`
- **Render:** Uses `render.yaml`

Link your GitHub repo to your platform of choice and make sure to add `GEMINI_API_KEY` as an environment variable in their dashboard.

## Future Plans
- Adding CSV uploads to the dashboard for batch processing
- CRM integrations (Salesforce, HubSpot, etc.)
- Using Playwright or Puppeteer to handle JavaScript-heavy websites that regular scrapers miss
