"""
Export Router - PDF and other export format endpoints.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Optional, Literal

from services.pdf_export import generate_translation_pdf

router = APIRouter()


class ChunkData(BaseModel):
    """Chunk data for PDF export."""
    id: str
    text: str
    translation: str
    type: Literal['heading', 'paragraph', 'list', 'table'] = 'paragraph'
    position: int = 0


class ExportPdfRequest(BaseModel):
    """Request model for PDF export."""
    chunks: List[ChunkData]
    title: str = "Technical Translation"
    include_original: bool = False


@router.post("/pdf")
async def export_pdf(request: ExportPdfRequest):
    """
    Generate a text-based PDF from translated chunks.
    
    Returns a downloadable PDF file with:
    - Selectable/searchable Chinese text
    - Preserved markdown formatting
    - Page numbers and headers
    """
    if not request.chunks:
        raise HTTPException(status_code=400, detail="No chunks provided")
    
    try:
        # Convert to dict format for PDF generator
        chunks_data = [
            {
                "translation": chunk.translation,
                "type": chunk.type,
                "text": chunk.text,
            }
            for chunk in request.chunks
        ]
        
        print(f"[PDF Export] Generating PDF with {len(chunks_data)} chunks...")
        pdf_bytes = generate_translation_pdf(chunks_data, request.title)
        
        print(f"[PDF Export] PDF generated: {len(pdf_bytes)} bytes")
        
        # Return PDF as downloadable file
        filename = f"translation_{request.title[:30].replace(' ', '_')}.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": str(len(pdf_bytes))
            }
        )
        
    except Exception as e:
        print(f"[PDF Export] Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")


@router.get("/pdf/test")
async def test_pdf():
    """Test PDF generation with sample content."""
    test_chunks = [
        {"translation": "# 技术标准翻译测试", "type": "heading"},
        {"translation": "这是一个测试段落，包含中文和English混合内容。\n\nPDF生成成功！", "type": "paragraph"},
        {"translation": "## 第二章 安全要求", "type": "heading"},
        {"translation": "- 第一项安全要求\n- 第二项安全要求\n- 第三项安全要求", "type": "paragraph"},
        {"translation": "1. 操作前检查设备状态\n2. 确认所有安全装置正常\n3. 开始操作程序", "type": "paragraph"},
    ]
    
    try:
        pdf_bytes = generate_translation_pdf(test_chunks, "PDF测试文档")
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": 'attachment; filename="test_translation.pdf"'
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Test PDF failed: {str(e)}")
