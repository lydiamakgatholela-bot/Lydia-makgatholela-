import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";

// --- BEATS ---
const BEATS = [
    { name: "Trap Beat", url: "https://storage.googleapis.com/maker-suite-media/prompts-lib/example-audio/trap-beat-120-bpm.mp3" },
    { name: "Lo-fi Beat", url: "https://storage.googleapis.com/maker-suite-media/prompts-lib/example-audio/lo-fi-beat-100-bpm.mp3" },
    { name: "Hip Hop Beat", url: "https://storage.googleapis.com/maker-suite-media/prompts-lib/example-audio/hip-hop-beat-90-bpm.mp3" },
];

// --- Helper Functions for Saving Audio ---
const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

const base64ToBlobUrl = async (base64: string): Promise<string> => {
    const response = await fetch(base64);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
};


const StudioApp = () => {
    const [selectedBeatUrl, setSelectedBeatUrl] = useState<string>('');
    const [isRecording, setIsRecording] = useState<boolean>(false);
    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
    const [recordedAudioBase64, setRecordedAudioBase64] = useState<string | null>(null); // For saving
    const [instrumentalVolume, setInstrumentalVolume] = useState<number>(0.7);
    const [vocalVolume, setVocalVolume] = useState<number>(1);
    
    // AI Lyric Assistant State
    const [lyricTopic, setLyricTopic] = useState<string>('');
    const [generatedLyrics, setGeneratedLyrics] = useState<string>('');
    const [isGenerating, setIsGenerating] = useState<boolean>(false);

    // Refs for Web Audio API
    const audioContextRef = useRef<AudioContext | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);
    
    const instrumentalSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const instrumentalGainRef = useRef<GainNode | null>(null);
    const vocalSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const vocalGainRef = useRef<GainNode | null>(null);
    
    // Visualizer Refs
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animationFrameIdRef = useRef<number | null>(null);

    const isInitialized = useRef<boolean>(false);

    // Initialize AudioContext
    const initAudioContext = useCallback(() => {
        if (!isInitialized.current) {
            const context = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioContextRef.current = context;
            
            analyserRef.current = context.createAnalyser();
            analyserRef.current.fftSize = 256;
            analyserRef.current.connect(context.destination);

            isInitialized.current = true;
        }
    }, []);

    const loadAudio = async (url: string) => {
        if (!audioContextRef.current) return null;
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        return audioContextRef.current.decodeAudioData(arrayBuffer);
    };

    const handleSelectBeat = async (url: string) => {
        handleStop(); 
        setSelectedBeatUrl(url);
    };

    const handleRecordToggle = async () => {
        initAudioContext();
        if (isRecording) {
            mediaRecorderRef.current?.stop();
            setIsRecording(false);
        } else {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorderRef.current = new MediaRecorder(stream);
                
                mediaRecorderRef.current.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        recordedChunksRef.current.push(event.data);
                    }
                };
                
                mediaRecorderRef.current.onstop = async () => {
                    const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
                    setRecordedAudioUrl(URL.createObjectURL(blob));
                    const base64 = await blobToBase64(blob);
                    setRecordedAudioBase64(base64);
                    recordedChunksRef.current = [];
                    stream.getTracks().forEach(track => track.stop());
                };
                
                recordedChunksRef.current = [];
                setRecordedAudioUrl(null);
                setRecordedAudioBase64(null);
                mediaRecorderRef.current.start();
                setIsRecording(true);
                
                if(selectedBeatUrl) {
                     handlePlay();
                }

            } catch (err) {
                console.error("Error accessing microphone:", err);
                alert("Microphone access was denied. Please allow microphone access in your browser settings.");
            }
        }
    };
    
    const handlePlay = async () => {
        if (isPlaying) return;
        initAudioContext();
        if (!audioContextRef.current) return;
        await audioContextRef.current.resume();

        if (instrumentalSourceRef.current) instrumentalSourceRef.current.stop();
        if (vocalSourceRef.current) vocalSourceRef.current.stop();
        
        let instrumentalReady = false;
        let vocalsReady = false;

        if (selectedBeatUrl) {
            const instrumentalBuffer = await loadAudio(selectedBeatUrl);
            if (instrumentalBuffer) {
                instrumentalSourceRef.current = audioContextRef.current.createBufferSource();
                instrumentalSourceRef.current.buffer = instrumentalBuffer;
                instrumentalGainRef.current = audioContextRef.current.createGain();
                instrumentalGainRef.current.gain.value = instrumentalVolume;
                instrumentalSourceRef.current.connect(instrumentalGainRef.current).connect(analyserRef.current!);
                instrumentalReady = true;
            }
        } else {
             instrumentalReady = true;
        }

        if (recordedAudioUrl) {
            const vocalBuffer = await loadAudio(recordedAudioUrl);
            if(vocalBuffer){
                vocalSourceRef.current = audioContextRef.current.createBufferSource();
                vocalSourceRef.current.buffer = vocalBuffer;
                vocalGainRef.current = audioContextRef.current.createGain();
                vocalGainRef.current.gain.value = vocalVolume;
                vocalSourceRef.current.connect(vocalGainRef.current).connect(analyserRef.current!);
                vocalsReady = true;
            }
        } else {
            vocalsReady = true;
        }

        if (instrumentalReady && vocalsReady) {
            instrumentalSourceRef.current?.start(0);
            vocalSourceRef.current?.start(0);
            setIsPlaying(true);
            
            const longestSource = (vocalSourceRef.current?.buffer?.duration ?? 0) > (instrumentalSourceRef.current?.buffer?.duration ?? 0) ? vocalSourceRef.current : instrumentalSourceRef.current;
            if (longestSource) {
                 longestSource.onended = () => setIsPlaying(false);
            } else if (!isRecording) {
                 setIsPlaying(false);
            }
        }
    };

    const handleStop = () => {
        if (isRecording) {
            handleRecordToggle();
        }
        instrumentalSourceRef.current?.stop();
        vocalSourceRef.current?.stop();
        setIsPlaying(false);
    };

    const handleNewProject = () => {
        if (window.confirm("Are you sure you want to start a new project? Any unsaved work will be lost.")) {
            handleStop();
            setSelectedBeatUrl('');
            setRecordedAudioUrl(null);
            setRecordedAudioBase64(null);
            setInstrumentalVolume(0.7);
            setVocalVolume(1);
            setLyricTopic('');
            setGeneratedLyrics('');
            localStorage.removeItem('makgatholelaStudioProject');
        }
    };

    useEffect(() => {
        if (instrumentalGainRef.current) {
            instrumentalGainRef.current.gain.value = instrumentalVolume;
        }
    }, [instrumentalVolume]);

    useEffect(() => {
        if (vocalGainRef.current) {
            vocalGainRef.current.gain.value = vocalVolume;
        }
    }, [vocalVolume]);

    // --- Save Project State ---
    useEffect(() => {
        const projectState = {
            selectedBeatUrl,
            instrumentalVolume,
            vocalVolume,
            recordedAudioBase64,
            lyricTopic,
            generatedLyrics,
        };
        // Auto-save whenever a key property changes
        if (selectedBeatUrl || recordedAudioBase64) {
             localStorage.setItem('makgatholelaStudioProject', JSON.stringify(projectState));
        }
    }, [selectedBeatUrl, instrumentalVolume, vocalVolume, recordedAudioBase64, lyricTopic, generatedLyrics]);

    // --- Load Project State on Mount ---
    useEffect(() => {
        const loadProject = async () => {
            const savedProjectJSON = localStorage.getItem('makgatholelaStudioProject');
            if (savedProjectJSON) {
                const savedProject = JSON.parse(savedProjectJSON);
                setSelectedBeatUrl(savedProject.selectedBeatUrl || '');
                setInstrumentalVolume(savedProject.instrumentalVolume || 0.7);
                setVocalVolume(savedProject.vocalVolume || 1);
                setLyricTopic(savedProject.lyricTopic || '');
                setGeneratedLyrics(savedProject.generatedLyrics || '');

                if (savedProject.recordedAudioBase64) {
                    setRecordedAudioBase64(savedProject.recordedAudioBase64);
                    const blobUrl = await base64ToBlobUrl(savedProject.recordedAudioBase64);
                    setRecordedAudioUrl(blobUrl);
                }
            }
        };
        loadProject();
    }, []); // Empty dependency array ensures this runs only once on mount.


    const handleGenerateLyrics = async () => {
        if (!lyricTopic.trim()) {
            alert("Please enter a topic for the lyrics.");
            return;
        }
        setIsGenerating(true);
        setGeneratedLyrics('');
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `Write a short 8-bar rap verse about "${lyricTopic}". Make it creative and rhythmic.`,
            });
            setGeneratedLyrics(response.text);
        } catch (error) {
            console.error("Error generating lyrics:", error);
            setGeneratedLyrics("Sorry, something went wrong while generating lyrics. Please try again.");
        } finally {
            setIsGenerating(false);
        }
    };

    const drawVisualizer = useCallback(() => {
        if (!analyserRef.current || !canvasRef.current) return;

        animationFrameIdRef.current = requestAnimationFrame(drawVisualizer);

        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserRef.current.getByteFrequencyData(dataArray);

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const { width, height } = canvas;
        ctx.clearRect(0, 0, width, height);

        const barWidth = (width / bufferLength) * 2.5;
        let barHeight;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i] * (height / 256);
            ctx.fillStyle = '#00f2ea';
            ctx.fillRect(x, height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    }, []);

    useEffect(() => {
        if (isPlaying) {
            animationFrameIdRef.current = requestAnimationFrame(drawVisualizer);
        } else {
            if (animationFrameIdRef.current) {
                cancelAnimationFrame(animationFrameIdRef.current);
            }
            const canvas = canvasRef.current;
            if (canvas && canvas.getContext('2d')) {
                const ctx = canvas.getContext('2d')!;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        }
        return () => {
            if (animationFrameIdRef.current) {
                cancelAnimationFrame(animationFrameIdRef.current);
            }
        };
    }, [isPlaying, drawVisualizer]);

    return (
        <div className="studio-container">
            <header>
                <h1>MAKGATHOLELA STUDIO</h1>
                <div className="transport-controls">
                     <button onClick={handleNewProject}>
                        NEW
                    </button>
                    <button 
                        className={`record-btn ${isRecording ? 'recording' : ''}`}
                        onClick={handleRecordToggle}
                    >
                        {isRecording ? '■' : '●'} REC
                    </button>
                    <button onClick={handlePlay} disabled={isRecording || isPlaying || (!selectedBeatUrl && !recordedAudioUrl)}>
                       ▶ PLAY
                    </button>
                     <button onClick={handleStop} disabled={!isPlaying && !isRecording}>
                        ■ STOP
                    </button>
                </div>
            </header>
            <main>
                <section className="panel browser-panel">
                    <h2>Browser</h2>
                    <ul>
                        {BEATS.map((beat) => (
                            <li key={beat.name} className={selectedBeatUrl === beat.url ? 'selected' : ''}>
                                <span>{beat.name}</span>
                                <button onClick={() => handleSelectBeat(beat.url)} disabled={isRecording}>
                                    Load
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>

                <section className="panel playlist-panel">
                    <h2>Playlist</h2>
                    <div className="playlist-tracks">
                         <div className="track">
                            <div className="track-header">Track 1 - Instrumental</div>
                            <div className="track-lane">
                                {selectedBeatUrl && <div className="audio-clip instrumental-clip">Beat Loaded</div>}
                            </div>
                        </div>
                        <div className="track">
                            <div className="track-header">Track 2 - Vocals</div>
                            <div className="track-lane">
                                {recordedAudioUrl && <div className="audio-clip vocal-clip">Vocal Recording</div>}
                            </div>
                        </div>
                    </div>
                </section>

                <section className="panel mixer-tools-panel">
                    <div className="mixer">
                        <h2>Mixer</h2>
                        <div className="mixer-channels">
                           <div className="mixer-channel">
                               <label htmlFor="instrumental-volume">INST</label>
                               <input 
                                   type="range"
                                   id="instrumental-volume"
                                   className="vertical-slider"
                                   min="0" max="1" step="0.01" 
                                   value={instrumentalVolume}
                                   onChange={(e) => setInstrumentalVolume(parseFloat(e.target.value))}
                               />
                               <span>{Math.round(instrumentalVolume * 100)}</span>
                           </div>
                           <div className="mixer-channel">
                               <label htmlFor="vocal-volume">VOC</label>
                               <input 
                                   type="range" 
                                   id="vocal-volume" 
                                   className="vertical-slider"
                                   min="0" max="1" step="0.01" 
                                   value={vocalVolume}
                                   onChange={(e) => setVocalVolume(parseFloat(e.target.value))}
                               />
                               <span>{Math.round(vocalVolume * 100)}</span>
                           </div>
                           <div className="mixer-channel master-channel">
                                <label>MASTER</label>
                                <canvas ref={canvasRef}></canvas>
                           </div>
                        </div>
                    </div>

                    <div className="lyric-assistant">
                        <h2>AI Lyric Assistant</h2>
                        <div className='lyric-input'>
                            <input 
                                type="text"
                                value={lyricTopic}
                                onChange={(e) => setLyricTopic(e.target.value)}
                                placeholder="Enter a topic (e.g., city lights)"
                                disabled={isGenerating}
                            />
                            <button onClick={handleGenerateLyrics} disabled={isGenerating} className='primary'>
                                {isGenerating ? '...' : 'Generate'}
                            </button>
                        </div>
                        <div className="lyric-display">
                            {isGenerating ? "Generating..." : generatedLyrics || "Your generated lyrics will appear here..."}
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<StudioApp />);