"""
Document Parsing Router - PDF and Markdown parsing endpoints.
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from models.responses import ParseResult, DocumentStructure
from services.mineru_service import extract_with_mineru, is_mineru_configured

router = APIRouter()


@router.post("/pdf", response_model=ParseResult)
async def parse_pdf(
    file: UploadFile = File(...),
    use_mineru: bool = Form(default=True)
):
    """
    Parse a PDF file and extract structured content.
    
    - **file**: PDF file to parse
    - **use_mineru**: Use MinerU Cloud API for extraction (recommended for complex PDFs)
    """
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="File must be a PDF")
    
    # Check file size (max 50MB)
    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size must be less than 50MB")
    
    try:
        if use_mineru:
            if not is_mineru_configured():
                raise HTTPException(
                    status_code=400, 
                    detail="MinerU API key not configured. Set via /api/keys endpoint."
                )
            
            document = await extract_with_mineru(content, file.filename)
        else:
            # Fallback: basic text extraction without MinerU
            # In production, could use PyMuPDF or similar
            raise HTTPException(
                status_code=501, 
                detail="Legacy PDF parsing not yet implemented. Please enable MinerU."
            )
        
        return ParseResult(success=True, document=document)
    
    except HTTPException:
        raise
    except Exception as e:
        return ParseResult(success=False, error=str(e))


@router.post("/markdown", response_model=ParseResult)
async def parse_markdown(file: UploadFile = File(...)):
    """
    Parse a Markdown file and extract structured content.
    
    - **file**: Markdown (.md) file to parse
    """
    if not file.filename or not file.filename.lower().endswith('.md'):
        raise HTTPException(status_code=400, detail="File must be a Markdown file (.md)")
    
    try:
        content = await file.read()
        text = content.decode('utf-8')
        
        # Simple word count
        word_count = len(text.split())
        
        # Detect language
        chinese_chars = len([c for c in text if '\u4e00' <= c <= '\u9fff'])
        if chinese_chars / max(len(text), 1) > 0.1:
            language = "zh"
        else:
            language = "en"
        
        document = DocumentStructure(
            text=text,
            pages=max(1, word_count // 500),
            word_count=word_count,
            language=language
        )
        
        return ParseResult(success=True, document=document)
    
    except Exception as e:
        return ParseResult(success=False, error=str(e))
