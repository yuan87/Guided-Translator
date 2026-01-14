"""
MinerU Cloud API Service - PDF to Markdown extraction.
"""

import httpx
import asyncio
from typing import Optional, Callable
from config import settings
from models.responses import DocumentStructure


def is_mineru_configured() -> bool:
    """Check if MinerU API key is configured."""
    return bool(settings.mineru_api_key)


async def submit_extraction_task(file_content: bytes, filename: str) -> str:
    """
    Submit PDF to MinerU for extraction.
    Returns batch_id for status polling.
    """
    import base64
    
    file_base64 = base64.b64encode(file_content).decode('utf-8')
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{settings.mineru_api_base}/extract/task",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {settings.mineru_api_key}"
            },
            json={
                "file": file_base64,
                "file_name": filename,
                "is_ocr": True,
                "enable_formula": True,
                "enable_table": True,
                "output_format": "markdown"
            }
        )
        
        if response.status_code != 200:
            raise Exception(f"MinerU API error: {response.status_code} - {response.text}")
        
        result = response.json()
        
        if result.get("code") != 0:
            raise Exception(f"MinerU task submission failed: {result.get('msg')}")
        
        batch_id = result["data"]["batch_id"]
        print(f"[MinerU] Task submitted: {batch_id}")
        return batch_id


async def poll_task_status(
    batch_id: str,
    on_progress: Optional[Callable[[int], None]] = None,
    max_wait_seconds: int = 300
) -> dict:
    """
    Poll MinerU task status until completion.
    Returns the result data containing markdown_url or markdown_content.
    """
    poll_interval = 3  # seconds
    elapsed = 0
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        while elapsed < max_wait_seconds:
            response = await client.get(
                f"{settings.mineru_api_base}/extract/task/{batch_id}",
                headers={"Authorization": f"Bearer {settings.mineru_api_key}"}
            )
            
            if response.status_code != 200:
                raise Exception(f"MinerU status check failed: {response.status_code}")
            
            result = response.json()
            
            if result.get("code") != 0:
                raise Exception(f"MinerU status error: {result.get('msg')}")
            
            data = result["data"]
            state = data.get("state")
            progress = data.get("progress", 0)
            
            print(f"[MinerU] Task {batch_id}: {state} ({progress}%)")
            
            if on_progress:
                on_progress(progress)
            
            if state == "completed":
                return data
            
            if state == "failed":
                raise Exception(f"MinerU extraction failed: {data.get('error', 'Unknown error')}")
            
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
    
    raise Exception("MinerU task timed out")


async def download_markdown(url: str) -> str:
    """Download markdown content from result URL."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url)
        if response.status_code != 200:
            raise Exception(f"Failed to download markdown: {response.status_code}")
        return response.text


def detect_language(text: str) -> str:
    """Simple language detection based on Chinese character ratio."""
    chinese_chars = len([c for c in text if '\u4e00' <= c <= '\u9fff'])
    total_chars = len(text)
    
    if total_chars > 0 and chinese_chars / total_chars > 0.1:
        return "zh"
    return "en"


async def extract_with_mineru(
    file_content: bytes,
    filename: str,
    on_progress: Optional[Callable[[int], None]] = None
) -> DocumentStructure:
    """
    Extract structured content from PDF using MinerU Cloud API.
    
    Args:
        file_content: Raw PDF bytes
        filename: Original filename
        on_progress: Optional callback for progress updates (0-100)
    
    Returns:
        DocumentStructure with extracted markdown text
    """
    print(f"[MinerU] Starting extraction for: {filename}")
    
    # Submit task
    batch_id = await submit_extraction_task(file_content, filename)
    
    # Poll for completion
    task_result = await poll_task_status(batch_id, on_progress)
    
    # Get markdown content
    result_data = task_result.get("result", {})
    
    if result_data.get("markdown_content"):
        markdown_content = result_data["markdown_content"]
    elif result_data.get("markdown_url"):
        markdown_content = await download_markdown(result_data["markdown_url"])
    else:
        raise Exception("MinerU result does not contain markdown content")
    
    print(f"[MinerU] Extraction complete, markdown length: {len(markdown_content)}")
    
    # Detect language and count words
    language = detect_language(markdown_content)
    word_count = len(markdown_content.split())
    pages = max(1, word_count // 500)
    
    return DocumentStructure(
        text=markdown_content,
        pages=pages,
        word_count=word_count,
        language=language
    )
