// Document Upload Component
import { useState, useRef } from 'react';
import { FileUp, File, Check, AlertCircle, Loader2 } from 'lucide-react';
import type { DocumentStructure } from '../types';
import { extractStructuredContent } from '../services/documentParser';

interface DocumentUploadProps {
    onDocumentLoaded: (doc: DocumentStructure) => void;
    currentDocument: DocumentStructure | null;
}

export default function DocumentUpload({ onDocumentLoaded, currentDocument }: DocumentUploadProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const file = e.dataTransfer.files[0];
        if (file) {
            await processFile(file);
        }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            await processFile(file);
        }
    };

    const processFile = async (file: File) => {
        if (!file.name.endsWith('.pdf')) {
            setError('Please upload a PDF file');
            return;
        }

        if (file.size > 50 * 1024 * 1024) {
            setError('File size must be less than 50MB');
            return;
        }

        setIsProcessing(true);
        setError(null);
        setProgress({ current: 0, total: 0 });

        try {
            const doc = await extractStructuredContent(file, (current, total) => {
                setProgress({ current, total });
            });

            if (doc.language !== 'en') {
                setError(`Warning: Document appears to be in ${doc.language === 'zh' ? 'Chinese' : 'an unknown language'}. Please upload an English document.`);
            }

            onDocumentLoaded(doc);
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Failed to process PDF');
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <File className="w-5 h-5" />
                Upload Document
            </h2>

            {/* Upload Area */}
            <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
                    }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                <FileUp className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p className="text-gray-600 mb-2">
                    Drag PDF file here or{' '}
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-blue-600 hover:underline font-medium"
                    >
                        browse
                    </button>
                </p>
                <p className="text-sm text-gray-500">Maximum file size: 50MB</p>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    onChange={handleFileSelect}
                    className="hidden"
                />
            </div>

            {/* Processing State */}
            {isProcessing && (
                <div className="mt-4 text-center">
                    <Loader2 className="w-8 h-8 mx-auto mb-2 text-blue-600 animate-spin" />
                    <p className="text-gray-600">
                        {progress.total > 0
                            ? `Extracting text... Page ${progress.current}/${progress.total}`
                            : 'Processing PDF...'}
                    </p>
                    {progress.total > 0 && (
                        <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                            <div
                                className="bg-blue-600 h-2 rounded-full transition-all"
                                style={{ width: `${(progress.current / progress.total) * 100}%` }}
                            ></div>
                        </div>
                    )}
                </div>
            )}

            {/* Error Message */}
            {error && (
                <div className="mt-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-red-800 text-sm">{error}</p>
                </div>
            )}

            {/* Document Summary */}
            {currentDocument && (
                <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-start gap-2">
                        <Check className="w-5 h-5 text-blue-600 mt-0.5" />
                        <div>
                            <p className="text-blue-800 font-medium">Document Loaded</p>
                            <div className="text-blue-700 text-sm mt-1 space-y-1">
                                <p>📄 {currentDocument.pages} pages</p>
                                <p>📝 ~{currentDocument.wordCount.toLocaleString()} words</p>
                                <p>🌐 Language: {currentDocument.language === 'en' ? 'English' : currentDocument.language === 'zh' ? 'Chinese' : 'Unknown'}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
