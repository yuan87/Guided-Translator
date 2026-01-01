# Guided Translator - Blueprint

## Project Overview

**Guided Translator** is a glossary-aware translation application that leverages refined terminology from **Standard Linguist** to produce consistent, domain-accurate translations of technical standards. It uses LLM with glossary constraints to ensure translation quality.

## Core Concept

**Glossary Reusability**: The glossary extracted from one standard is used to translate **different but related** standards in the same technical domain.

```
Standard Linguist (Phase 1)          Guided Translator (Phase 2)
├─ Document A (e.g., IEC 60950)      ├─ Import glossary from Doc A
├─ Extract glossary                  ├─ Upload Document B (e.g., IEC 62368)
├─ Critique & refine terms           │  └─ Different standard, same domain
└─ Export final CSV                  ├─ LLM translates with glossary
                                     ├─ Track coverage (70% matched)
                                     └─ Export translation + new terms
```

**Key Insight**: Not all terms will match (partial coverage expected), but the glossary ensures consistency for common domain terminology.

## Key Features

### 1. Glossary Import
- **CSV Upload**: Import glossary CSV from Standard Linguist
- **Preview & Validation**: Display loaded terms (English → Chinese)
- **Editable**: Allow minor corrections before translation

### 2. Document Translation
- **Chunk-Based Processing**: Split large documents into manageable sections
- **Glossary-Constrained Prompting**: Inject glossary into LLM context
- **Consistency Tracking**: Highlight terms that match glossary vs. new translations

### 3. Quality Assurance
- **Side-by-Side View**: Original | Translated paragraphs
- **Term Highlighting**: Color-code glossary terms in both versions
- **Coverage Metrics**: Display "Glossary Coverage: 65% (450/690 terms matched)"
- **Deviation Alerts**: Flag when LLM uses non-glossary translation
- **New Term Discovery**: Track novel terms for glossary expansion

### 4. Export Options
- **Formatted Output**: PDF or DOCX with preserved structure
- **Translation Memory**: Export new terms discovered during translation

## Technical Architecture

### Frontend
- **React + TypeScript** (consistency with Standard Linguist)
- **Tailwind CSS** or styled-components
- **PDF.js** for document rendering
- **Split view UI** for comparison

### Backend / AI Service
- **Gemini 3 Pro** (same as Standard Linguist)
- **Prompt Engineering**:
  ```
  System: You are translating a technical standard.
  
  GLOSSARY (from related standard):
  [Inject CSV terms here]
  
  RULES:
  1. Use EXACT glossary translations when terms appear
  2. For new terms not in glossary, translate naturally
  3. Maintain technical accuracy and consistency
  4. Preserve document structure
  
  NOTE: This document differs from the glossary source but is in the same domain.
  ```

### Data Flow
```
User uploads CSV → Parse glossary → Store in memory
User uploads PDF → Extract text → Split into chunks
For each chunk:
  - Identify glossary terms
  - Send to LLM with glossary context
  - Receive translation
  - Highlight matched terms
Reconstruct document → Export
```

## File Structure (Suggested)

```
guided-translator/
├── components/
│   ├── GlossaryUpload.tsx       # CSV import & preview
│   ├── DocumentUpload.tsx       # PDF upload
│   ├── TranslationPanel.tsx     # Split view (original | translated)
│   ├── ProgressTracker.tsx      # Chunk progress indicator
│   └── ExportOptions.tsx        # Download controls
├── services/
│   ├── geminiService.ts         # Translation API calls
│   ├── glossaryParser.ts        # CSV parser
│   ├── documentParser.ts        # PDF text extraction
│   └── chunkManager.ts          # Split/merge logic
├── types.ts
├── App.tsx
└── index.html
```

## Workflow (User Journey)

1. **Setup Phase**
   - Click "Import Glossary" → Upload CSV from Standard Linguist
   - Preview loaded terms (e.g., "500 terms loaded from IEC 60950")

2. **Translation Phase**
   - Click "Upload Document" → Select **different** English PDF (e.g., IEC 62368)
   - App extracts text, identifies glossary term matches
   - Displays: "Glossary coverage: ~65% of document terms"
   - Progress bar: "Translating chunk 3/25..."
   - Real-time preview of translated sections

3. **Review Phase**
   - Scroll through side-by-side comparison
   - Glossary terms highlighted in **green** (matched)
   - Non-glossary translations in **blue** (newly translated)
   - Click to edit individual segments

4. **Export Phase**
   - Choose format: PDF, DOCX, or plain text
   - **Bonus**: Export "New Terms" CSV to expand original glossary

## Advanced Features (Future)

- **Multi-Document Projects**: Translate entire document sets with shared glossary
- **Version Control**: Track translation changes over time
- **Collaborative Review**: Share links for team feedback
- **Custom Rules**: User-defined translation patterns (e.g., "shall" → "应")

## Integration with Standard Linguist

| Standard Linguist | Guided Translator |
|------------------|------------------|
| **Input**: IEC 60950 (English + Chinese) | **Glossary**: CSV from IEC 60950 |
| **Output**: `IEC_60950_Glossary.csv` | **Input**: IEC 62368 (English only) |
| 500 refined terms | Uses glossary + LLM for new terms |
| | **Output**: IEC 62368 (Chinese translation) |

**Key Benefit**: One glossary serves multiple related standards in the same domain.

## Tech Stack Summary

- **Frontend**: React 19, TypeScript, Tailwind CSS
- **AI**: Gemini 3 Pro API
- **PDF Handling**: PDF.js (extraction), jsPDF (generation)
- **State**: React hooks + Context API
- **Build**: Vite

## Success Metrics

- ✅ 95%+ glossary term adherence
- ✅ <2 min per page translation time
- ✅ Preserves document structure (headings, tables, lists)
- ✅ Exportable to standard formats

## Next Steps

1. Create project scaffold with Vite + React + TS
2. Implement CSV parser and glossary viewer
3. Build chunking algorithm for large documents
4. Design LLM prompt template with glossary injection
5. Create side-by-side translation UI
6. Add export functionality
