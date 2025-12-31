// Translation Panel Component - Side by side view
import { useRef } from 'react';
import type { TranslatedChunk, TermMatch } from '../types';

interface TranslationPanelProps {
    chunks: TranslatedChunk[];
    onScroll?: (position: number) => void;
}

export default function TranslationPanel({ chunks, onScroll }: TranslationPanelProps) {
    const originalRef = useRef<HTMLDivElement>(null);
    const translatedRef = useRef<HTMLDivElement>(null);

    // Synchronized scrolling
    const handleScroll = (source: 'original' | 'translated') => (e: React.UIEvent<HTMLDivElement>) => {
        const scrollTop = e.currentTarget.scrollTop;

        if (source === 'original' && translatedRef.current) {
            translatedRef.current.scrollTop = scrollTop;
        } else if (source === 'translated' && originalRef.current) {
            originalRef.current.scrollTop = scrollTop;
        }

        onScroll?.(scrollTop);
    };

    const highlightTerms = (text: string, matches: TermMatch[]) => {
        if (matches.length === 0) return text;

        // Sort matches by position (descending) to replace from end to start
        const sortedMatches = [...matches].sort((a, b) =>
            (b.positions[0] || 0) - (a.positions[0] || 0)
        );

        let result = text;
        const processedPositions = new Set<number>();

        for (const match of sortedMatches) {
            for (const pos of match.positions) {
                if (processedPositions.has(pos)) continue;

                const before = result.slice(0, pos);
                const term = result.slice(pos, pos + match.english.length);
                const after = result.slice(pos + match.english.length);

                const highlightClass = match.source === 'glossary'
                    ? 'bg-green-200 border-b-2 border-green-500'
                    : 'bg-blue-200 border-b-2 border-blue-500';

                result = `${before}<mark class="${highlightClass}" title="${match.chinese}">${term}</mark>${after}`;
                processedPositions.add(pos);
            }
        }

        return result;
    };

    if (chunks.length === 0) {
        return (
            <div className="bg-white rounded-lg shadow-md p-6">
                <p className="text-center text-gray-500">
                    Upload a glossary and document to begin translation
                </p>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="grid grid-cols-2 border-b bg-gray-50">
                <div className="p-3 border-r">
                    <h3 className="font-semibold text-gray-700">Original (English)</h3>
                </div>
                <div className="p-3">
                    <h3 className="font-semibold text-gray-700">Translation (Chinese)</h3>
                </div>
            </div>

            <div className="grid grid-cols-2 h-[600px]">
                {/* Original Text */}
                <div
                    ref={originalRef}
                    onScroll={handleScroll('original')}
                    className="overflow-y-auto p-6 border-r prose prose-sm max-w-none"
                >
                    {chunks.map((chunk, index) => (
                        <div key={chunk.id} className="mb-6 pb-4 border-b border-gray-200 last:border-0">
                            <div className="text-xs text-gray-400 mb-2">Chunk {index + 1}</div>
                            <div
                                className={`${chunk.type === 'heading' ? 'font-bold text-lg' : ''}`}
                                dangerouslySetInnerHTML={{
                                    __html: highlightTerms(chunk.text, chunk.matchedTerms)
                                }}
                            />
                        </div>
                    ))}
                </div>

                {/* Translated Text */}
                <div
                    ref={translatedRef}
                    onScroll={handleScroll('translated')}
                    className="overflow-y-auto p-6 prose prose-sm max-w-none"
                >
                    {chunks.map((chunk, index) => (
                        <div key={chunk.id} className="mb-6 pb-4 border-b border-gray-200 last:border-0">
                            <div className="text-xs text-gray-400 mb-2">段落 {index + 1}</div>
                            <div className={`${chunk.type === 'heading' ? 'font-bold text-lg' : ''}`}>
                                {chunk.translation}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Legend */}
            <div className="border-t bg-gray-50 p-3 flex gap-4 text-sm">
                <div className="flex items-center gap-2">
                    <span className="inline-block w-4 h-4 bg-green-200 border-b-2 border-green-500"></span>
                    <span className="text-gray-600">Glossary term</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="inline-block w-4 h-4 bg-blue-200 border-b-2 border-blue-500"></span>
                    <span className="text-gray-600">New term</span>
                </div>
            </div>
        </div>
    );
}
