// ============================================================
// SubTick — useReaderHUD Hook
// Extracted from ReaderScreen. Handles HUD visibility,
// auto-hide timer, and like/save toggle state.
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';

interface UseReaderHUDResult {
  isLiked: boolean;
  isSaved: boolean;
  hudVisible: boolean;
  hudTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  setIsLiked: (v: boolean) => void;
  setIsSaved: (v: boolean) => void;
  setHudVisible: React.Dispatch<React.SetStateAction<boolean>>;
  handleHudAutoHide: (visible: boolean, duration?: number) => void;
}

export function useReaderHUD(): UseReaderHUDResult {
  const [isLiked, setIsLiked] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [hudVisible, setHudVisible] = useState(false);

  const hudTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleHudAutoHide = useCallback((visible: boolean, duration: number = 2500) => {
    if (hudTimeoutRef.current) {
      clearTimeout(hudTimeoutRef.current);
      hudTimeoutRef.current = null;
    }
    if (visible) {
      hudTimeoutRef.current = setTimeout(() => {
        setHudVisible(false);
      }, duration);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    };
  }, [handleHudAutoHide]);

  return {
    isLiked,
    isSaved,
    hudVisible,
    hudTimeoutRef,
    setIsLiked,
    setIsSaved,
    setHudVisible,
    handleHudAutoHide,
  };
}