"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { EChartsOption } from "echarts";
import { echarts, type EChartsType } from "./echarts-core";
import { prefersReducedMotion } from "./motion";

/**
 * SSR/jsdom-safe ECharts host. Initializes only in the browser inside a
 * try/catch — if init fails (tests, exotic environments) the container simply
 * stays empty and text content remains available to assertions.
 */
export const useECharts = (
  option: EChartsOption,
  enabled = true,
): RefObject<HTMLDivElement | null> => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    let chart: EChartsType;
    try {
      chart = echarts.init(container, undefined, { renderer: "svg" });
    } catch {
      chartRef.current = null;
      return undefined;
    }
    chartRef.current = chart;

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        try {
          chart.resize();
        } catch {
          /* container may be detached during teardown */
        }
      });
      observer.observe(container);
    }
    const handleResize = () => {
      try {
        chart.resize();
      } catch {
        /* ignore transient resize errors */
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", handleResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !chartRef.current) return;
    try {
      chartRef.current.setOption(
        { animation: !prefersReducedMotion(), ...option },
        { notMerge: true },
      );
    } catch {
      /* option failed to apply — leave previous render */
    }
  }, [option, enabled]);

  return containerRef;
};
