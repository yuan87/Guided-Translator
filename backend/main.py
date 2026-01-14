"""
Guided Translator Backend - FastAPI Application

Provides API endpoints for:
- Document parsing (PDF via MinerU, Markdown)
- Translation (Gemini API with glossary support)
- API key management
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import parse, translate, keys
from config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown events."""
    # Startup
    print(f"🚀 Starting Guided Translator Backend v1.0.0")
    print(f"📍 API docs available at: http://localhost:8000/docs")
    yield
    # Shutdown
    print("👋 Shutting down backend...")


app = FastAPI(
    title="Guided Translator API",
    description="Backend API for terminology-aware technical document translation",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "http://localhost:1420",  # Tauri dev
        "tauri://localhost",      # Tauri production
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(parse.router, prefix="/api/parse", tags=["Parsing"])
app.include_router(translate.router, prefix="/api/translate", tags=["Translation"])
app.include_router(keys.router, prefix="/api/keys", tags=["API Keys"])


@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "Guided Translator Backend",
        "version": "1.0.0"
    }


@app.get("/health")
async def health_check():
    """Detailed health check."""
    return {
        "status": "healthy",
        "gemini_configured": bool(settings.gemini_api_key),
        "mineru_configured": bool(settings.mineru_api_key)
    }
