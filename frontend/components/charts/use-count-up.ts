"use client";

import { useEffect, useRef, useState } from "react";
import { shouldAnimateNumbers } from "./motion";

const easeOutCubic = (progress: number): number =>
  1 - Math.pow(1 - progress, 3);

/**
 * Animates the value toward `target` on mount/target-change in real browsers;
 * returns `target` directly in jsdom/reduced-motion so tests and AT see stable
 * text immediately. State updates happen only inside rAF callbacks.
 */
export const useCountUp = (target: number, duration = 700): number => {
  const animatable = shouldAnimateNumbers();
  const [display, setDisplay] = useState<number>(0);
  const currentRef = useRef<number>(0);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    if (!animatable) return undefined;
    const from = currentRef.current;
    let start: number | null = null;

    const step = (timestamp: number) => {
      if (start === null) start = timestamp;
      const progress = Math.min((timestamp - start) / duration, 1);
      const value = from + (target - from) * easeOutCubic(progress);
      currentRef.current = value;
      setDisplay(value);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        currentRef.current = target;
        setDisplay(target);
      }
    };
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration, animatable]);

  return animatable ? display : target;
};
