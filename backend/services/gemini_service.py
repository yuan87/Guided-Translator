"""
Gemini API Service - Translation with glossary support.
"""

import google.generativeai as genai
from typing import Optional
from models.requests import GlossaryEntry, Chunk
from models.responses import TranslatedChunk, TermMatch
from routers.keys import get_current_gemini_key, rotate_gemini_key


def find_relevant_terms(text: str, glossary: list[GlossaryEntry]) -> list[GlossaryEntry]:
    """Find glossary terms that appear in the text."""
    text_lower = text.lower()
    return [
        entry for entry in glossary
        if entry.english.lower() in text_lower
    ]


def generate_prompt(text: str, relevant_terms: list[GlossaryEntry]) -> str:
    """Generate translation prompt with glossary constraints."""
    
    glossary_section = ""
    if relevant_terms:
        terms_list = "\n".join([
            f"- {t.english} → {t.chinese}" 
            for t in relevant_terms
        ])
        glossary_section = f"""
## Mandatory Terminology
You MUST use these exact translations for the following terms:
{terms_list}
"""
    
    return f"""# Technical Document Translation Task

## Instructions
Translate the following English technical document content into Simplified Chinese.

## Rules
1. Preserve all Markdown formatting (headers, lists, tables, code blocks)
2. Keep technical terms, standards codes (e.g., EN 13001, ISO 9001), and formulas unchanged
3. Maintain the exact document structure
4. Do NOT add explanations or commentary
5. Output ONLY the translated text
{glossary_section}
## Source Text
{text}

## Translation (Chinese):"""


def clean_response(text: str) -> str:
    """Clean LLM response by removing markdown blocks and meta text."""
    # Remove markdown code blocks if present
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first and last lines if they're code fences
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)
    
    return text.strip()


def identify_terms_in_text(
    text: str,
    glossary: list[GlossaryEntry]
) -> list[TermMatch]:
    """Find and locate glossary terms in translated text."""
    matches = []
    text_lower = text.lower()
    
    for entry in glossary:
        # Search for Chinese term in translated text
        chinese_term = entry.chinese
        start = 0
        while True:
            idx = text.find(chinese_term, start)
            if idx == -1:
                break
            matches.append(TermMatch(
                term=entry.english,
                translation=entry.chinese,
                start_index=idx,
                end_index=idx + len(chinese_term)
            ))
            start = idx + 1
    
    return matches


async def translate_chunk(
    chunk: Chunk,
    glossary: list[GlossaryEntry],
    on_status: Optional[callable] = None
) -> TranslatedChunk:
    """
    Translate a single chunk with glossary constraints.
    Handles API key rotation on rate limit errors.
    """
    api_key = get_current_gemini_key()
    
    if not api_key:
        raise Exception("No Gemini API key configured")
    
    # Find relevant terms for this chunk
    relevant_terms = find_relevant_terms(chunk.content, glossary)
    
    # Generate prompt
    prompt = generate_prompt(chunk.content, relevant_terms)
    
    # Try translation with retry on rate limit
    max_retries = 3
    last_error = None
    
    for attempt in range(max_retries):
        try:
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel("gemini-2.0-flash")
            
            if on_status:
                on_status(f"Translating chunk {chunk.id}...")
            
            response = model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(
                    temperature=0.3,
                    max_output_tokens=4096
                )
            )
            
            translated_text = clean_response(response.text)
            
            # Find terms used in translation
            terms_used = identify_terms_in_text(translated_text, relevant_terms)
            
            return TranslatedChunk(
                id=chunk.id,
                original=chunk.content,
                translated=translated_text,
                terms_used=terms_used,
                tokens_used=None  # Could extract from response metadata
            )
            
        except Exception as e:
            last_error = e
            error_msg = str(e).lower()
            
            # Check for rate limit error
            if "429" in error_msg or "rate" in error_msg or "quota" in error_msg:
                if on_status:
                    on_status(f"Rate limited, rotating key...")
                
                if rotate_gemini_key():
                    api_key = get_current_gemini_key()
                    continue
            
            # For other errors, don't retry
            break
    
    raise Exception(f"Translation failed after {max_retries} attempts: {last_error}")
