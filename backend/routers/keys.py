"""
API Keys Router - Manage API keys at runtime.
"""

from fastapi import APIRouter
from models.requests import SetApiKeysRequest
from models.responses import ApiKeyStatus
from config import settings, update_api_keys

router = APIRouter()

# In-memory storage for multiple Gemini keys
gemini_key_pool: list[str] = []
current_key_index: int = 0


@router.post("", response_model=ApiKeyStatus)
async def set_api_keys(request: SetApiKeysRequest):
    """Set API keys for Gemini and MinerU."""
    global gemini_key_pool, current_key_index
    
    if request.gemini_keys:
        gemini_key_pool = [k for k in request.gemini_keys if k]
        current_key_index = 0
        if gemini_key_pool:
            update_api_keys(gemini_key=gemini_key_pool[0])
    
    if request.mineru_key:
        update_api_keys(mineru_key=request.mineru_key)
    
    return ApiKeyStatus(
        gemini_configured=bool(gemini_key_pool),
        gemini_key_count=len(gemini_key_pool),
        mineru_configured=bool(settings.mineru_api_key)
    )


@router.get("/status", response_model=ApiKeyStatus)
async def get_key_status():
    """Get current API key configuration status."""
    return ApiKeyStatus(
        gemini_configured=bool(gemini_key_pool) or bool(settings.gemini_api_key),
        gemini_key_count=len(gemini_key_pool) if gemini_key_pool else (1 if settings.gemini_api_key else 0),
        mineru_configured=bool(settings.mineru_api_key)
    )


def get_current_gemini_key() -> str | None:
    """Get the current active Gemini API key."""
    if gemini_key_pool:
        return gemini_key_pool[current_key_index]
    return settings.gemini_api_key or None


def rotate_gemini_key() -> bool:
    """Rotate to next Gemini API key. Returns True if rotation successful."""
    global current_key_index
    
    if len(gemini_key_pool) <= 1:
        return False
    
    current_key_index = (current_key_index + 1) % len(gemini_key_pool)
    update_api_keys(gemini_key=gemini_key_pool[current_key_index])
    return True
