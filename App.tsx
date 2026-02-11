import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Header } from './components/Header';
import { WebcamFeed } from './components/WebcamFeed';
import { Footer } from './components/Footer';
import { RememberPersonModal } from './components/RememberPersonModal';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { describeScene, describePerson, askWithContext } from './services/geminiService';
import { speak, stopSpeech } from './services/ttsService';
import { liveService } from './services/liveService';
import type { RememberedPerson, LanguageOption } from './types';
import { LANGUAGES } from './constants';

const App: React.FC = () => {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [speechSpeed, setSpeechSpeed] = useState(1.0);
    const [language, setLanguage] = useState<LanguageOption>(LANGUAGES[0]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [currentAction, setCurrentAction] = useState<string | null>(null);
    const [rememberedPeople, setRememberedPeople] = useState<RememberedPerson[]>([]);
    
    // Replaced isNavigating with isLive
    const [isLive, setIsLive] = useState(false);
    
    const [showRememberModal, setShowRememberModal] = useState(false);
    const [frameToRemember, setFrameToRemember] = useState<string | null>(null);

    const webcamRef = useRef<HTMLVideoElement>(null);
    const isCancelledRef = useRef(false);

    const { isListening, transcript, startListening, stopListening } = useSpeechRecognition(language.code);
    
    useEffect(() => {
        const updateOnlineStatus = () => setIsOnline(navigator.onLine);
        window.addEventListener('online', updateOnlineStatus);
        window.addEventListener('offline', updateOnlineStatus);

        speak('Welcome to OptiRead!', language.voice, speechSpeed);

        return () => {
            window.removeEventListener('online', updateOnlineStatus);
            window.removeEventListener('offline', updateOnlineStatus);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const captureFrame = useCallback((): string | null => {
        if (webcamRef.current && webcamRef.current.readyState >= 2) {
            const canvas = document.createElement('canvas');
            const video = webcamRef.current;
            const scale = 0.5; // Capture at 50% resolution for faster processing
            canvas.width = video.videoWidth * scale;
            canvas.height = video.videoHeight * scale;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(webcamRef.current, 0, 0, canvas.width, canvas.height);
                // Use jpeg with quality setting for smaller file size
                return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
            }
        }
        return null;
    }, []);

    const handleStop = useCallback(() => {
        isCancelledRef.current = true;
        stopSpeech();
        if (isListening) stopListening();
        
        // Stop Live Mode
        if (isLive) {
            liveService.stop();
            setIsLive(false);
        }
        
        if (showRememberModal) setShowRememberModal(false);
        setIsProcessing(false);
        setCurrentAction(null);
        setTimeout(() => { isCancelledRef.current = false; }, 100);
    }, [isListening, isLive, stopListening, showRememberModal]);

    const processAndSpeak = useCallback(async (action: Promise<string>, actionType: string) => {
        isCancelledRef.current = false;
        setIsProcessing(true);
        setCurrentAction(actionType);
        try {
            const responseText = await action;
            if (isCancelledRef.current) return;
            await speak(responseText, language.voice, speechSpeed);
        } catch (error) {
            if (isCancelledRef.current) return;
            console.error('An error occurred:', error);
            const errorMessage = 'Sorry, I encountered an error. Please try again.';
            await speak(errorMessage, language.voice, speechSpeed);
        } finally {
            if (currentAction === actionType) {
                setIsProcessing(false);
                setCurrentAction(null);
            }
        }
    }, [language.voice, speechSpeed, currentAction]);

    const handleDescribe = useCallback(() => {
        if (currentAction === 'describe') {
            handleStop();
            return;
        }
        if (isProcessing) return;
        const frame = captureFrame();
        if (frame) {
            const status = 'Analyzing the scene...';
            speak(status, language.voice, speechSpeed);
            processAndSpeak(describeScene(frame, undefined, language.name), 'describe');
        }
    }, [captureFrame, processAndSpeak, isProcessing, currentAction, handleStop, language.voice, language.name, speechSpeed]);

    const handlePerson = useCallback(() => {
        if (currentAction === 'person') {
            handleStop();
            return;
        }
        if (isProcessing) return;
        const frame = captureFrame();
        if (frame) {
            const status = 'Looking for a person...';
            speak(status, language.voice, speechSpeed);
            processAndSpeak(describePerson(frame, rememberedPeople, language.name), 'person');
        }
    }, [captureFrame, processAndSpeak, rememberedPeople, isProcessing, currentAction, handleStop, language.voice, language.name, speechSpeed]);

    const handleRemember = useCallback(() => {
        if (isProcessing) return;
        const frame = captureFrame();
        if (frame) {
            setFrameToRemember(frame);
            setShowRememberModal(true);
        }
    }, [captureFrame, isProcessing]);
    
    const handleSavePerson = useCallback((name: string) => {
        if (name.trim() && frameToRemember) {
            setRememberedPeople(prev => [...prev, { name: name.trim(), imageBase64: frameToRemember }]);
            const confirmation = `I'll remember ${name.trim()}.`;
            speak(confirmation, language.voice, speechSpeed);
        }
        setShowRememberModal(false);
        setFrameToRemember(null);
    }, [frameToRemember, language.voice, speechSpeed]);

    const handleAsk = useCallback(() => {
        if (currentAction === 'ask') {
            handleStop();
        } else if (isListening) {
            stopListening();
        } else if (!isProcessing) {
            const status = 'Listening...';
            speak(status, language.voice, speechSpeed);
            startListening();
        }
    }, [isListening, startListening, stopListening, currentAction, handleStop, isProcessing, language.voice, speechSpeed]);

    useEffect(() => {
        if (!isListening && transcript) {
            const frame = captureFrame();
            const question = `Asking: "${transcript}"`;
            speak(question, language.voice, speechSpeed);
            processAndSpeak(askWithContext(frame, transcript, language.name), 'ask');
        }
    }, [isListening, transcript, captureFrame, processAndSpeak, language.name, language.voice, speechSpeed]);

    const handleLive = useCallback(async () => {
        if (isLive) {
            await liveService.stop();
            setIsLive(false);
            setCurrentAction(null);
        } else {
            // Stop other actions first
            handleStop();
            setCurrentAction('live');
            setIsLive(true);
            try {
                await liveService.start({
                    voiceName: language.voice,
                    onClose: () => {
                        setIsLive(false);
                        setCurrentAction(null);
                    }
                });
            } catch (e) {
                console.error("Failed to start live service", e);
                setIsLive(false);
                setCurrentAction(null);
                speak("Could not start live mode.", language.voice, speechSpeed);
            }
        }
    }, [isLive, handleStop, language.voice, speechSpeed]);

    // Effect to push video frames to Live API
    useEffect(() => {
        let intervalId: number;
        if (isLive) {
            intervalId = window.setInterval(() => {
                const frame = captureFrame();
                if (frame) {
                    liveService.sendVideoFrame(frame);
                }
            }, 500); // 2 FPS
        }
        return () => clearInterval(intervalId);
    }, [isLive, captureFrame]);


    return (
        <div className="flex flex-col h-screen bg-gray-900 font-sans">
            <Header
                isOnline={isOnline}
                speechSpeed={speechSpeed}
                setSpeechSpeed={setSpeechSpeed}
                language={language}
                setLanguage={setLanguage}
            />
            <main className="flex-grow flex flex-col items-center justify-center p-4 relative overflow-hidden">
                <WebcamFeed ref={webcamRef} />
                <div className="absolute inset-0 bg-black bg-opacity-30 pointer-events-none"></div>
                {isLive && (
                    <div className="absolute top-4 right-4 animate-pulse flex items-center space-x-2 bg-red-600 bg-opacity-80 px-3 py-1 rounded-full z-20">
                        <div className="w-2 h-2 bg-white rounded-full"></div>
                        <span className="text-white text-xs font-bold uppercase tracking-wider">LIVE</span>
                    </div>
                )}
            </main>
            {showRememberModal && (
                <RememberPersonModal
                    isOpen={showRememberModal}
                    onClose={() => setShowRememberModal(false)}
                    onSave={handleSavePerson}
                />
            )}
            <Footer
                onDescribe={handleDescribe}
                onPerson={handlePerson}
                onRemember={handleRemember}
                onAsk={handleAsk}
                onLive={handleLive}
                isProcessing={isProcessing}
                isListening={isListening}
                isLive={isLive}
                currentAction={currentAction}
            />
        </div>
    );
};

export default App;