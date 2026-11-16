import { useEffect, useState } from 'react';
import type { BackendFolder, BackendState } from '../../../shared/backendState';
import { formatBytes } from '../utils/bytes';
import { formatDuration } from '../utils/duration';
import { latencyRange, latencyStats, latencyTone } from '../utils/latency';
import { STATUS_DOT, STATUS_TITLE } from './BackendStatus';
import { Sparkline } from './Sparkline';
import { Card } from './ui';

const TONE = { ok: 'text-(--dolq-ok)', warn: 'text-(--dolq-warn)', danger: 'text-(--dolq-danger)' };

// Below this a folder's disk is nearly full: the backend itself warns at the same point, and refuses a download at 100 MB.
const LOW_BYTES = 1_000_000_000;
const LOW_FRACTION = 0.1;

export function folderTone(f: Pick<BackendFolder, 'free' | 'total'>): 'ok' | 'warn' | 'danger' {
  if (f.free < LOW_BYTES) return 'danger';
  return f.total > 0 && f.free / f.total < LOW_FRACTION ? 'warn' : 'ok';
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[12px] text-(--dolq-text-faint)">{label}</dt>
      <dd className="m-0 truncate text-[15px] text-(--dolq-text)">{value}</dd>
    </div>
  );
}

function Folder({ folder }: { folder: BackendFolder }) {
  if (folder.error) {
    return (
      <li className="flex flex-col gap-0.5 text-[13px]">
        <span className="text-(--dolq-text)">
          {folder.name} <span className="text-(--dolq-text-faint)">{folder.path}</span>
        </span>
        <span className="text-(--dolq-danger)">Cannot tell how much room is left: {folder.error}</span>
      </li>
    );
  }
  const used = folder.total > 0 ? Math.round(((folder.total - folder.free) / folder.total) * 100) : 0;
  const tone = folderTone(folder);
  return (
    <li className="flex flex-col gap-1 text-[13px]">
      <div className="flex items-baseline gap-2">
        <span className="text-(--dolq-text)">{folder.name}</span>
        <span className="min-w-0 flex-1 truncate text-(--dolq-text-faint)">{folder.path}</span>
        <span className={TONE[tone]}>
          {formatBytes(folder.free, 1000)} free of {formatBytes(folder.total, 1000)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${folder.name} folder, ${used}% used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used}
        className="h-1.5 overflow-hidden rounded-full bg-(--dolq-bg-panel)"
      >
        <div
          className={`h-full rounded-full ${tone === 'ok' ? 'bg-(--dolq-ok)' : tone === 'warn' ? 'bg-(--dolq-warn)' : 'bg-(--dolq-danger)'}`}
          style={{ width: `${used}%` }}
        />
      </div>
    </li>
  );
}

type Props = {
  state: BackendState;
  onReconnect: () => void;
};

/** The dashboard's view of the backend: the link (status, round trip, how long it has held, how often it broke) and what the backend says about itself (version, load, disk room). */
export function BackendMonitor({ state, onReconnect }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const remote = state.mode === 'remote';
  const title = remote ? 'Remote backend' : 'Local backend';
  const stats = state.status === 'connected' ? latencyStats(state.latency) : null;
  const { info } = state;
  const recent = state.log.slice(-4);

  return (
    <Card className="divide-y-0">
      <section aria-label="Backend" className="flex flex-col gap-3 px-4 py-3.5">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${STATUS_DOT[state.status]}`} />
          <h2 className="m-0 text-[15px] font-medium text-(--dolq-text)">{title}</h2>
          {state.address && (
            <span className="min-w-0 truncate text-[13px] text-(--dolq-text-dim)">{state.address}</span>
          )}
          <span className="text-[13px] text-(--dolq-text-dim)">{STATUS_TITLE[state.status]}</span>
          {stats && (
            <span className={`ml-auto text-[18px] font-medium ${TONE[latencyTone(stats.last)]}`}>{stats.last} ms</span>
          )}
        </div>

        {state.status !== 'connected' && (
          <div className="flex items-start gap-3">
            <p className="m-0 flex-1 text-[13px] leading-snug text-(--dolq-text-muted)">{state.detail}</p>
            <button
              type="button"
              onClick={onReconnect}
              className="shrink-0 cursor-pointer rounded-lg border border-(--dolq-border-strong) bg-transparent px-3 py-1 text-[13px] text-(--dolq-text) hover:bg-(--dolq-bg-row-hover)"
            >
              Reconnect
            </button>
          </div>
        )}

        {stats && (
          <div className="flex items-center gap-4 text-(--dolq-brand-text)">
            <Sparkline
              values={state.latency.map((x) => x.ms)}
              label={`Round trip to the backend over time, ${stats.last} ms now`}
              width={240}
              range={latencyRange(stats)}
            />
            <span className="text-[12px] text-(--dolq-text-dim)">
              min {stats.min} · avg {stats.avg} · max {stats.max} ms
            </span>
          </div>
        )}
        {state.status === 'connected' && remote && stats === null && (
          <span className="text-[13px] text-(--dolq-text-faint)">Measuring the round trip…</span>
        )}

        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Fact label="Connected for" value={state.connectedSince ? formatDuration(now - state.connectedSince) : '—'} />
          <Fact label="Dropped" value={`${state.reconnects} ${state.reconnects === 1 ? 'time' : 'times'}`} />
          {info && (
            <>
              <Fact label="Version" value={info.version} />
              <Fact label="Running for" value={formatDuration(info.uptimeMs)} />
              <Fact label="IRC connections" value={String(info.sessions)} />
              <Fact label="Apps attached" value={String(info.clients)} />
              <Fact label="Transfers" value={String(info.transfers)} />
            </>
          )}
        </dl>

        {info && info.folders.length > 0 && (
          <ul aria-label="Disk room" className="m-0 flex list-none flex-col gap-2.5 p-0">
            {info.folders.map((f) => (
              <Folder key={f.name} folder={f} />
            ))}
          </ul>
        )}
        {state.status === 'connected' && !state.infoSupported && (
          <p className="m-0 text-[12px] text-(--dolq-text-faint)">
            This backend is older than the monitoring and does not report its version or its disk room. Update it to see
            them here.
          </p>
        )}

        {recent.length > 0 && (
          <ol aria-label="Recent connection activity" className="m-0 flex list-none flex-col gap-0.5 p-0 text-[12px]">
            {recent.map((l) => (
              <li key={`${l.at}-${l.text}`} className="truncate text-(--dolq-text-dim)">
                <span className="mr-2 text-(--dolq-text-faint)">{time(l.at)}</span>
                {l.text}
              </li>
            ))}
          </ol>
        )}
      </section>
    </Card>
  );
}
