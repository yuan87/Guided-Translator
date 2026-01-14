"""
Pydantic models for API request bodies.
"""

from pydantic import BaseModel, Field
from typing import Optional


class GlossaryEntry(BaseModel):
    """A single glossary term mapping."""
    english: str = Field(..., description="English term")
    chinese: str = Field(..., description="Chinese translation")
    

class Chunk(BaseModel):
    """A text chunk to be translated."""
    id: str = Field(..., description="Unique chunk identifier")
    content: str = Field(..., description="Text content to translate")
    index: int = Field(..., description="Chunk index in document")


class TranslateChunkRequest(BaseModel):
    """Request body for single chunk translation."""
    chunk: Chunk
    glossary: list[GlossaryEntry] = Field(default_factory=list)
    source_language: str = Field(default="en")
    target_language: str = Field(default="zh")


class TranslateBatchRequest(BaseModel):
    """Request body for batch translation with SSE streaming."""
    chunks: list[Chunk]
    glossary: list[GlossaryEntry] = Field(default_factory=list)
    source_language: str = Field(default="en")
    target_language: str = Field(default="zh")


class ParsePdfRequest(BaseModel):
    """Request body for PDF parsing (file sent as form data)."""
    use_mineru: bool = Field(default=True, description="Use MinerU Cloud API")


class SetApiKeysRequest(BaseModel):
    """Request body for setting API keys."""
    gemini_keys: Optional[list[str]] = Field(default=None, description="Gemini API keys")
    mineru_key: Optional[str] = Field(default=None, description="MinerU API key")
