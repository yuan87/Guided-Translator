"""
Translation Router - Single chunk and batch translation with SSE streaming.
"""

import json
import asyncio
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse

from models.requests import TranslateChunkRequest, TranslateBatchRequest
from models.responses import TranslatedChunk, TranslationProgress
from services.gemini_service import translate_chunk
from routers.keys import get_current_gemini_key

router = APIRouter()


@router.post("/chunk", response_model=TranslatedChunk)
async def translate_single_chunk(request: TranslateChunkRequest):
    """
    Translate a single chunk with glossary constraints.
    
    - **chunk**: The text chunk to translate
    - **glossary**: List of term mappings to enforce
    """
    if not get_current_gemini_key():
        raise HTTPException(
            status_code=400,
            detail="No Gemini API key configured. Set via /api/keys endpoint."
        )
    
    try:
        result = await translate_chunk(
            chunk=request.chunk,
            glossary=request.glossary
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batch")
async def translate_batch(request: TranslateBatchRequest):
    """
    Batch translate multiple chunks with SSE streaming progress.
    
    Returns a Server-Sent Events stream with real-time progress updates.
    
    Events:
    - `progress`: Progress update with current/total
    - `chunk_complete`: A chunk finished translating
    - `error`: An error occurred
    - `done`: All chunks completed
    """
    if not get_current_gemini_key():
        raise HTTPException(
            status_code=400,
            detail="No Gemini API key configured. Set via /api/keys endpoint."
        )
    
    async def event_generator():
        """Generate SSE events for translation progress."""
        total = len(request.chunks)
        translated_chunks = []
        
        for i, chunk in enumerate(request.chunks):
            try:
                # Send progress event
                progress = TranslationProgress(
                    event="progress",
                    chunk_id=chunk.id,
                    current=i,
                    total=total
                )
                yield {
                    "event": "progress",
                    "data": progress.model_dump_json()
                }
                
                # Translate the chunk
                result = await translate_chunk(
                    chunk=chunk,
                    glossary=request.glossary
                )
                translated_chunks.append(result)
                
                # Send chunk complete event
                complete = TranslationProgress(
                    event="chunk_complete",
                    chunk_id=chunk.id,
                    current=i + 1,
                    total=total,
                    translated_chunk=result
                )
                yield {
                    "event": "chunk_complete",
                    "data": complete.model_dump_json()
                }
                
                # Small delay to avoid rate limiting
                await asyncio.sleep(0.3)
                
            except Exception as e:
                # Send error event
                error = TranslationProgress(
                    event="error",
                    chunk_id=chunk.id,
                    current=i,
                    total=total,
                    error_message=str(e)
                )
                yield {
                    "event": "error",
                    "data": error.model_dump_json()
                }
                # Continue with next chunk instead of stopping
        
        # Send done event
        done = TranslationProgress(
            event="done",
            current=total,
            total=total
        )
        yield {
            "event": "done",
            "data": done.model_dump_json()
        }
    
    return EventSourceResponse(event_generator())


@router.post("/batch/sync", response_model=list[TranslatedChunk])
async def translate_batch_sync(request: TranslateBatchRequest):
    """
    Batch translate multiple chunks synchronously (no streaming).
    
    Use /batch for real-time progress updates via SSE.
    """
    if not get_current_gemini_key():
        raise HTTPException(
            status_code=400,
            detail="No Gemini API key configured. Set via /api/keys endpoint."
        )
    
    results = []
    
    for chunk in request.chunks:
        try:
            result = await translate_chunk(
                chunk=chunk,
                glossary=request.glossary
            )
            results.append(result)
            
            # Rate limiting delay
            await asyncio.sleep(0.5)
            
        except Exception as e:
            # Create error result
            results.append(TranslatedChunk(
                id=chunk.id,
                original=chunk.content,
                translated=f"[Translation Error: {e}]",
                terms_used=[]
            ))
    
    return results
