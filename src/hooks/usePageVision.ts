import { useCallback, useEffect, useRef } from "react";
import { capturePageImage } from "../utils/pageVision/capture";
import {
  PageVisionController,
  type CaptureReason,
  type PageVisionClientConfig,
} from "../utils/pageVision/controller";
import { uploadScreenshot } from "../utils/pageVision/upload";

export interface UsePageVisionArgs {
  config: PageVisionClientConfig | null | undefined;
  connected: boolean;
  pathname: string;
  /** Latest flow.currentStep the widget observed (multi-step forms). */
  currentStep: number | undefined;
  publishData: (payload: Record<string, unknown>) => void;
  /**
   * Carry-forward 1: becomes true once the agent is ready to receive
   * messages (first listening/speaking state). On the first false→true
   * transition of each connect cycle, republishLast() is called so the
   * worker receives the flow_start envelope even if its listener
   * registered after the original publish.
   */
  agentReady: boolean;
}

/**
 * Fires page captures on session connect (flow_start), route change, and
 * flow step change. Captures wait two animation frames so the new view
 * has painted. All real logic lives in PageVisionController (tested).
 */
export function usePageVision(args: UsePageVisionArgs): void {
  const { config, connected, pathname, currentStep, publishData, agentReady } = args;

  const controllerRef = useRef<PageVisionController | null>(null);
  const publishRef = useRef(publishData);
  publishRef.current = publishData;
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    if (!config?.enabled) {
      controllerRef.current = null;
      return;
    }
    controllerRef.current = new PageVisionController({
      config,
      capture: capturePageImage,
      upload: uploadScreenshot,
      publish: (p) => publishRef.current(p),
    });
  }, [config]);

  const fire = useCallback(
    (reason: CaptureReason) => {
      const controller = controllerRef.current;
      if (!controller) return;
      // Two rAFs ≈ "after next paint" — the route/step change has rendered.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          void controller.trigger(reason, pathRef.current);
        }),
      );
    },
    [],
  );

  // Session connect → flow_start
  const prevConnected = useRef(false);
  useEffect(() => {
    if (connected && !prevConnected.current) fire("flow_start");
    prevConnected.current = connected;
  }, [connected, fire]);

  // Route change (skip the initial value)
  const prevPath = useRef(pathname);
  useEffect(() => {
    if (pathname !== prevPath.current) {
      prevPath.current = pathname;
      if (connected) fire("route_change");
    }
  }, [pathname, connected, fire]);

  // Step change (both sides defined and different)
  const prevStep = useRef(currentStep);
  useEffect(() => {
    if (
      connected &&
      currentStep !== undefined &&
      prevStep.current !== undefined &&
      currentStep !== prevStep.current
    ) {
      fire("step_change");
    }
    prevStep.current = currentStep;
  }, [currentStep, connected, fire]);

  // Carry-forward 1: agent first becomes ready → republish last envelope
  // so the worker's listener catches the flow_start even if it registered
  // late. The latch is per-CONNECT, not per-mount: it resets when the
  // connection drops so a reconnected session (whose flow_start capture may
  // be MAE-deduped away) still receives the envelope on its agent-ready.
  const agentReadyFiredRef = useRef(false);
  useEffect(() => {
    if (!connected) {
      agentReadyFiredRef.current = false;
      return;
    }
    if (agentReady && !agentReadyFiredRef.current) {
      agentReadyFiredRef.current = true;
      controllerRef.current?.republishLast();
    }
  }, [agentReady, connected]);
}
