// Progress Tracker Component
import { Loader2, Clock, CheckCircle2 } from 'lucide-react';
import type { TranslationProgress } from '../types';

interface ProgressTrackerProps {
    progress: TranslationProgress;
    isTranslating: boolean;
}

export default function ProgressTracker({ progress, isTranslating }: ProgressTrackerProps) {
    if (!isTranslating && progress.current === 0) {
        return null;
    }

    const isComplete = progress.current >= progress.total && progress.total > 0;
    const minutes = Math.floor(progress.estimatedTimeRemaining / 60);
    const seconds = progress.estimatedTimeRemaining % 60;

    return (
        <div className={`bg-white rounded-lg shadow-md p-6 ${isComplete ? 'border-2 border-green-500' : ''}`}>
            <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                    {isComplete ? (
                        <>
                            <CheckCircle2 className="w-5 h-5 text-green-600" />
                            Translation Complete
                        </>
                    ) : (
                        <>
                            <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                            Translating...
                        </>
                    )}
                </h3>

                {!isComplete && progress.estimatedTimeRemaining > 0 && (
                    <div className="flex items-center gap-1 text-sm text-gray-600">
                        <Clock className="w-4 h-4" />
                        <span>
                            ~{minutes > 0 ? `${minutes}m ` : ''}{seconds}s remaining
                        </span>
                    </div>
                )}
            </div>

            {/* Progress Bar */}
            <div className="mb-4">
                <div className="flex justify-between text-sm text-gray-600 mb-2">
                    <span>
                        Chunk {progress.current} of {progress.total}
                    </span>
                    <span>{progress.percentage}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                        className={`h-3 rounded-full transition-all ${isComplete ? 'bg-green-600' : 'bg-blue-600'}`}
                        style={{ width: `${progress.percentage}%` }}
                    ></div>
                </div>
            </div>

            {/* Coverage Stats */}
            {progress.glossaryCoverage.total > 0 && (
                <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-sm text-gray-700 mb-2 font-medium">Glossary Coverage</p>
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">
                            {progress.glossaryCoverage.matched} / {progress.glossaryCoverage.total} terms matched
                        </span>
                        <span className="text-sm font-semibold text-blue-600">
                            {Math.round((progress.glossaryCoverage.matched / progress.glossaryCoverage.total) * 100)}%
                        </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                        <div
                            className="bg-green-600 h-2 rounded-full transition-all"
                            style={{
                                width: `${(progress.glossaryCoverage.matched / progress.glossaryCoverage.total) * 100}%`
                            }}
                        ></div>
                    </div>
                </div>
            )}
        </div>
    );
}
