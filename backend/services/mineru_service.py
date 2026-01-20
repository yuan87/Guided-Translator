"""
MinerU Service - PDF to Markdown extraction.
VERSION: DEBUG BUILD - Extensive logging enabled
"""

import httpx
import requests
import asyncio
import uuid
import json
import io
import traceback
from typing import Optional, Callable
from config import settings
from models.responses import DocumentStructure


def log(msg: str):
    """Debug logger with timestamp."""
    import datetime
    ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[{ts}] [MinerU] {msg}")


def is_mineru_configured() -> bool:
    """Check if any MinerU option is configured."""
    local_url = getattr(settings, 'mineru_local_url', '')
    api_key = getattr(settings, 'mineru_api_key', '')
    
    log(f"Config check - local_url: '{local_url[:20] if local_url else 'NOT SET'}'")
    log(f"Config check - api_key: '{api_key[:20] + '...' if api_key else 'NOT SET'}'")
    
    return bool(local_url) or bool(api_key)


def is_mineru_local() -> bool:
    """Check if using local MinerU instance."""
    local_url = getattr(settings, 'mineru_local_url', '')
    return bool(local_url)


# ==================== Cloud API Functions ====================

async def get_cloud_upload_url(filename: str) -> tuple[str, str]:
    """Request a pre-signed upload URL from MinerU Cloud."""
    data_id = str(uuid.uuid4())[:8]
    
    log(f"Requesting upload URL for: {filename}")
    log(f"API Base: {settings.mineru_api_base}")
    log(f"Token prefix: {settings.mineru_api_key[:30]}...")
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{settings.mineru_api_base}/file-urls/batch",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {settings.mineru_api_key}"
            },
            json={
                "files": [{"name": filename, "data_id": data_id}],
                "model_version": "vlm"
            }
        )
        
        log(f"Upload URL request status: {response.status_code}")
        log(f"Response body: {response.text[:500]}")
        
        if response.status_code != 200:
            raise Exception(f"MinerU Cloud API error: {response.status_code} - {response.text[:200]}")
        
        result = response.json()
        if result.get("code") != 0:
            raise Exception(f"MinerU error: {result.get('msg')}")
        
        data = result["data"]
        batch_id = data["batch_id"]
        upload_url = data["file_urls"][0]
        
        log(f"Got batch_id: {batch_id}")
        log(f"Got upload_url: {upload_url[:80]}...")
        
        return batch_id, upload_url


async def upload_file_to_cloud(upload_url: str, file_content: bytes, filename: str) -> None:
    """Upload file to MinerU Cloud's pre-signed URL.
    Uses temp file + open() to match official example exactly.
    """
    import tempfile
    import os
    
    file_size_mb = len(file_content) / (1024 * 1024)
    log(f"Starting upload: {filename} ({file_size_mb:.2f} MB)")
    log(f"Upload URL: {upload_url[:80]}...")
    
    # Save to temporary file first (matching official example pattern)
    temp_path = None
    try:
        # Create temp file
        fd, temp_path = tempfile.mkstemp(suffix='.pdf')
        os.write(fd, file_content)
        os.close(fd)
        log(f"Created temp file: {temp_path}")
        
        def _upload():
            # Use actual file handle like official example: open(file, 'rb') as f
            with open(temp_path, 'rb') as f:
                log(f"Opened file handle, uploading...")
                return requests.put(upload_url, data=f, timeout=600)
        
        loop = asyncio.get_event_loop()
        
        log("Executing upload in thread pool...")
        start_time = asyncio.get_event_loop().time()
        response = await loop.run_in_executor(None, _upload)
        elapsed = asyncio.get_event_loop().time() - start_time
        
        log(f"Upload completed in {elapsed:.1f}s")
        log(f"Upload response status: {response.status_code}")
        log(f"Upload response body: {response.text[:500] if response.text else '(empty)'}")
        
        if response.status_code != 200:
            raise Exception(f"Cloud upload failed: {response.status_code} - {response.text[:200]}")
        
    finally:
        # Clean up temp file
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
            log(f"Cleaned up temp file")
    
    log("Upload successful!")


async def poll_cloud_batch_status(batch_id: str, on_progress: Optional[Callable[[int], None]] = None) -> dict:
    """Poll MinerU Cloud batch task status."""
    poll_interval = 5
    max_wait = 600
    elapsed = 0
    
    log(f"Starting to poll batch: {batch_id}")
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        while elapsed < max_wait:
            log(f"Polling... ({elapsed}s elapsed)")
            
            try:
                response = await client.get(
                    f"{settings.mineru_api_base}/extract-results/batch/{batch_id}",
                    headers={"Authorization": f"Bearer {settings.mineru_api_key}"}
                )
                
                log(f"Poll response status: {response.status_code}")
                
                if response.status_code == 200:
                    result = response.json()
                    log(f"Poll response code: {result.get('code')}, msg: {result.get('msg')}")
                    
                    if result.get("code") == 0:
                        data = result.get("data", {})
                        extract_result = data.get("extract_result", [])
                        state = data.get("state", "unknown")
                        progress = data.get("progress", 0)
                        
                        log(f"State: {state}, Progress: {progress}%, Results: {len(extract_result)}")
                        
                        if extract_result and len(extract_result) > 0:
                            log(f"Got results! Returning data...")
                            log(f"Data keys: {list(data.keys())}")
                            return data
                    else:
                        log(f"Non-zero code, continuing poll...")
                else:
                    log(f"Non-200 status, response: {response.text[:200]}")
                    
            except Exception as e:
                log(f"Poll error: {e}")
            
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
            
            if on_progress:
                on_progress(30 + min(50, elapsed // 10))
    
    raise Exception(f"MinerU Cloud task timed out after {max_wait}s")


async def extract_markdown_from_result(result_data: dict) -> str:
    """Extract markdown content from MinerU result."""
    log(f"Extracting markdown from result...")
    log(f"Result data keys: {list(result_data.keys())}")
    
    extract_result = result_data.get("extract_result", [])
    log(f"extract_result length: {len(extract_result)}")
    
    if not extract_result:
        log("ERROR: No extract_result in data!")
        log(f"Full result_data: {json.dumps(result_data, default=str)[:3000]}")
        raise Exception("No extraction results")
    
    first_result = extract_result[0]
    log(f"First result keys: {list(first_result.keys())}")
    log(f"First result preview: {json.dumps(first_result, default=str)[:1000]}")
    
    # Try markdown URL first
    md_url = first_result.get("full_md_url") or first_result.get("markdown_url")
    log(f"Markdown URL: {md_url[:80] if md_url else 'NOT FOUND'}")
    
    if md_url:
        log(f"Downloading markdown from URL...")
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            response = await client.get(md_url)
            log(f"Download status: {response.status_code}")
            if response.status_code == 200:
                content = response.text
                log(f"Downloaded markdown, length: {len(content)}")
                return content
            else:
                log(f"Download failed: {response.text[:200]}")
    
    # Try direct content
    md_content = first_result.get("md_content") or first_result.get("markdown_content")
    log(f"Direct md_content: {'Found, length=' + str(len(md_content)) if md_content else 'NOT FOUND'}")
    
    if md_content:
        return md_content
    
    # Dump everything for debugging
    log("ERROR: Could not find markdown in any field!")
    log(f"FULL RESULT DUMP: {json.dumps(result_data, default=str)[:5000]}")
    raise Exception("MinerU did not return markdown content")


# ==================== Local API Functions ====================

async def extract_with_local_mineru(
    file_content: bytes,
    filename: str,
    on_progress: Optional[Callable[[int], None]] = None
) -> DocumentStructure:
    """Extract using local MinerU API."""
    local_url = settings.mineru_local_url.rstrip('/')
    
    log(f"LOCAL MODE: Extracting {filename} ({len(file_content)/1024/1024:.2f} MB)")
    log(f"Local server: {local_url}")
    
    if on_progress:
        on_progress(10)
    
    def _upload_and_parse():
        return requests.post(
            f"{local_url}/file_parse",
            files={"files": (filename, file_content, "application/pdf")},
            data={
                "backend": "pipeline",
                "parse_method": "auto",
                "formula_enable": "true",
                "table_enable": "true",
                "return_md": "true",
                "lang_list": "ch",
            },
            timeout=600
        )
    
    loop = asyncio.get_event_loop()
    
    try:
        log("Sending to local server...")
        response = await loop.run_in_executor(None, _upload_and_parse)
        
        log(f"Local response status: {response.status_code}")
        
        if response.status_code != 200:
            raise Exception(f"Local error: {response.status_code} - {response.text[:500]}")
        
        result = response.json()
        results = result.get("results", {})
        
        if not results:
            raise Exception("Local returned empty results")
        
        first_key = list(results.keys())[0]
        file_result = results[first_key]
        markdown_content = file_result.get("md_content", "")
        
        if not markdown_content:
            raise Exception("Local did not return markdown content")
        
        log(f"Local extraction complete! Length: {len(markdown_content)}")
        
        if on_progress:
            on_progress(100)
        
        return DocumentStructure(
            text=markdown_content,
            pages=max(1, len(markdown_content.split()) // 500),
            word_count=len(markdown_content.split()),
            language=detect_language(markdown_content)
        )
        
    except requests.exceptions.ConnectionError as e:
        raise Exception(f"Cannot connect to local server: {e}")


# ==================== Cloud Extraction Function ====================

async def extract_with_cloud_mineru(
    file_content: bytes,
    filename: str,
    on_progress: Optional[Callable[[int], None]] = None
) -> DocumentStructure:
    """Extract using MinerU Cloud API."""
    log(f"CLOUD MODE: Starting extraction for {filename}")
    
    if on_progress:
        on_progress(5)
    
    try:
        # Step 1: Get upload URL
        log("=== STEP 1: Get upload URL ===")
        batch_id, upload_url = await get_cloud_upload_url(filename)
        
        if on_progress:
            on_progress(15)
        
        # Step 2: Upload file
        log("=== STEP 2: Upload file ===")
        await upload_file_to_cloud(upload_url, file_content, filename)
        
        if on_progress:
            on_progress(30)
        
        # Step 3: Poll for results
        log("=== STEP 3: Poll for results ===")
        result_data = await poll_cloud_batch_status(batch_id, on_progress)
        
        if on_progress:
            on_progress(90)
        
        # Step 4: Extract markdown
        log("=== STEP 4: Extract markdown ===")
        markdown_content = await extract_markdown_from_result(result_data)
        
        log(f"SUCCESS! Markdown length: {len(markdown_content)}")
        
        if on_progress:
            on_progress(100)
        
        return DocumentStructure(
            text=markdown_content,
            pages=max(1, len(markdown_content.split()) // 500),
            word_count=len(markdown_content.split()),
            language=detect_language(markdown_content)
        )
        
    except Exception as e:
        log(f"CLOUD EXTRACTION FAILED: {e}")
        log(f"Traceback: {traceback.format_exc()}")
        raise


# ==================== Helper Functions ====================

def detect_language(text: str) -> str:
    """Detect language based on Chinese character ratio."""
    chinese_chars = len([c for c in text if '\u4e00' <= c <= '\u9fff'])
    total_chars = len(text)
    if total_chars > 0 and chinese_chars / total_chars > 0.1:
        return "zh"
    return "en"


# ==================== Main Entry Point ====================

async def extract_with_mineru(
    file_content: bytes,
    filename: str,
    on_progress: Optional[Callable[[int], None]] = None
) -> DocumentStructure:
    """Main extraction function."""
    log("="*60)
    log(f"EXTRACT_WITH_MINERU called for: {filename}")
    log(f"File size: {len(file_content)} bytes ({len(file_content)/1024/1024:.2f} MB)")
    log("="*60)
    
    # Check configuration
    if not is_mineru_configured():
        raise Exception("MinerU not configured. Set MINERU_LOCAL_URL or MINERU_API_KEY in .env")
    
    # Prefer local MinerU
    if is_mineru_local():
        log("Using LOCAL server")
        return await extract_with_local_mineru(file_content, filename, on_progress)
    
    # Fall back to cloud API
    if settings.mineru_api_key:
        log("Using CLOUD API")
        return await extract_with_cloud_mineru(file_content, filename, on_progress)
    
    raise Exception("No MinerU configuration found")
