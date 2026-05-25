import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { BuildSummarySnapshot } from '../lib/api.ts';

export type BuildPhase = 'idle' | 'running' | 'done' | 'error';

interface BuildPanelProps {
  open: boolean;
  phase: BuildPhase;
  log: readonly string[];
  progress: { completed: number; total: number } | null;
  summary: BuildSummarySnapshot | null;
  error: string | null;
  onClose: () => void;
  onDownload: () => void;
  onRetry: () => void;
}

export function BuildPanel(props: BuildPanelProps): JSX.Element | null {
  const logRef = useRef<HTMLDivElement | null>(null);
  const logLength = props.log.length;
  // Pin the log to its tail so long builds don't trap the user reading the
  // first phase while routes keep rendering below. Re-runs whenever the log
  // grows; `logLength` is also read to satisfy exhaustive-deps without
  // suppressing the rule.
  useEffect(() => {
    if (logLength === 0) return;
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [logLength]);

  if (!props.open) return null;

  const showDownload = props.phase === 'done' && props.summary !== null;
  const showRetry = props.phase === 'error';

  return (
    <section class="buildPanel" aria-label="Build progress" aria-live="polite">
      <div class="buildPanelHead">
        <div class="buildPanelHeadText">
          <p class="buildPanelKicker">Build</p>
          <h2 class="buildPanelTitle">{titleFor(props.phase)}</h2>
        </div>
        <button
          type="button"
          class="buildPanelClose"
          onClick={props.onClose}
          aria-label="Close build panel"
        >
          ×
        </button>
      </div>
      {props.progress !== null ? (
        <div class="buildPanelProgress" aria-hidden="true">
          <div
            class="buildPanelProgressBar"
            style={{
              width: `${progressPercent(props.progress)}%`,
            }}
          />
          <span class="buildPanelProgressLabel">
            {props.progress.completed}/{props.progress.total} routes
          </span>
        </div>
      ) : null}
      <div class="buildPanelLog" ref={logRef}>
        {props.log.length === 0 ? (
          <p class="buildPanelLogEmpty">Starting build…</p>
        ) : (
          props.log.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only
            <div key={i} class="buildPanelLogLine">
              {line}
            </div>
          ))
        )}
        {props.error ? <div class="buildPanelLogError">{props.error}</div> : null}
      </div>
      {props.summary !== null ? (
        <div class="buildPanelSummary">
          <span class="buildPanelSummaryItem">{props.summary.routeCount} routes</span>
          <span class="buildPanelSummaryItem">{props.summary.assetCount} assets</span>
          {props.summary.outputBytes !== undefined ? (
            <span class="buildPanelSummaryItem">{formatBytes(props.summary.outputBytes)}</span>
          ) : null}
          <span class="buildPanelSummaryItem">{formatDuration(props.summary.durationMs)}</span>
          {props.summary.warningCount > 0 ? (
            <span class="buildPanelSummaryWarn">
              {props.summary.warningCount} warning{props.summary.warningCount === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
      ) : null}
      {showDownload || showRetry ? (
        <div class="buildPanelActions">
          {showDownload ? (
            <button type="button" class="buildPanelPrimary" onClick={props.onDownload}>
              Download zip
            </button>
          ) : null}
          {showRetry ? (
            <button type="button" class="buildPanelPrimary" onClick={props.onRetry}>
              Retry build
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function titleFor(phase: BuildPhase): string {
  switch (phase) {
    case 'running':
      return 'Building site…';
    case 'done':
      return 'Build complete';
    case 'error':
      return 'Build failed';
    default:
      return 'Build';
  }
}

function progressPercent(progress: { completed: number; total: number }): number {
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.round((progress.completed / progress.total) * 100));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}
