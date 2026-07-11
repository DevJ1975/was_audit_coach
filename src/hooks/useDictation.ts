/**
 * useDictation — voice-first text entry (NN #10) for the WEB build via the
 * browser SpeechRecognition API (Chrome/Edge/Safari). On native the OS
 * keyboard's mic key already provides dictation, so `supported` is false and
 * the UI renders nothing. One recognizer at a time; final transcripts are
 * delivered through onText and the caller appends them to its field.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => RecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  if (Platform.OS !== 'web') return null;
  const g = globalThis as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
}

export function useDictation(onText: (transcript: string) => void): {
  supported: boolean;
  listening: boolean;
  toggle: () => void;
} {
  const ctor = useRef<RecognitionCtor | null>(getRecognitionCtor());
  const rec = useRef<RecognitionLike | null>(null);
  const [listening, setListening] = useState(false);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const stop = useCallback(() => {
    rec.current?.stop();
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    if (listening) {
      stop();
      return;
    }
    const Ctor = ctor.current;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = 'en-US';
    r.continuous = true; // keep listening across pauses — gloved users talk in bursts
    r.interimResults = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i]?.[0]?.transcript;
        if (t) onTextRef.current(t.trim());
      }
    };
    r.onend = () => setListening(false); // browser auto-stops on long silence
    r.onerror = () => setListening(false);
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [listening, stop]);

  // Release the mic if the screen unmounts mid-dictation.
  useEffect(() => () => rec.current?.abort(), []);

  return { supported: ctor.current != null, listening, toggle };
}
