import type { ConnectionStatus } from '../../../shared/ipc';
import type { LatencySample } from '../store';
import type { Channel, Server } from '../types';
import { formatRate } from '../utils/bytes';
import { latencyStats, latencyTone } from '../utils/latency';
import { serverColor, serverIconText } from '../utils/server';
import { STATUS_LABEL } from './ServerList';
import { Sparkline } from './Sparkline';
import { Card } from './ui';

type Props = {
  servers: Server[];
  statusMap: Record<string, ConnectionStatus>;
  channelMap: Record<string, Channel[]>;
  latencyMap: Record<string, LatencySample[]>;
  rates: { down: number; up: number; active: number };
  onOpenServer: (serverId: string) => void;
  onOpenChannel: (serverId: string, channelId: string) => void;
};

const TONE = { ok: 'text-(--dolq-ok)', warn: 'text-(--dolq-warn)', danger: 'text-(--dolq-danger)' };

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3.5">
      <span className="text-[13px] text-(--dolq-text-dim)">{label}</span>
      <span className="text-[22px] font-medium text-(--dolq-text)">{value}</span>
      {hint && <span className="text-[12px] text-(--dolq-text-faint)">{hint}</span>}
    </div>
  );
}

/** The client's control panel: what is connected, how fast, and what is moving. */
export function Dashboard({ servers, statusMap, channelMap, latencyMap, rates, onOpenServer, onOpenChannel }: Props) {
  const connected = servers.filter((s) => statusMap[s.id] === 'connected').length;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-(--dolq-border) px-5">
        <h1 className="m-0 font-(family-name:--dolq-font-serif) text-[20px] font-medium text-(--dolq-text)">
          Dashboard
        </h1>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          <Card className="grid grid-cols-3 divide-x divide-y-0">
            <Stat label="Servers" value={`${connected} of ${servers.length}`} hint="connected" />
            <Stat label="Download" value={formatRate(rates.down)} hint={`${rates.active} active transfers`} />
            <Stat label="Upload" value={formatRate(rates.up)} />
          </Card>
          {servers.length === 0 && <p className="text-(--dolq-text-dim)">No servers yet. Add one from the rail.</p>}
          {servers.map((s) => {
            const status = statusMap[s.id] ?? 'disconnected';
            const samples = latencyMap[s.id] ?? [];
            const stats = status === 'connected' ? latencyStats(samples) : null;
            const joined = (channelMap[s.id] ?? []).filter((c) => c.joined && !c.isLog && !c.isQuery);
            return (
              <Card key={s.id} className="divide-y-0">
                <section aria-label={s.name} className="flex flex-col gap-3 px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      style={{ background: serverColor(s) }}
                      className="flex size-8 shrink-0 items-center justify-center rounded-[10px] text-[12px] font-semibold text-white"
                    >
                      {serverIconText(s)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenServer(s.id)}
                      className="cursor-pointer border-0 bg-transparent p-0 text-left text-[15px] font-medium text-(--dolq-text) hover:underline"
                    >
                      {s.name}
                    </button>
                    <span className="text-[13px] text-(--dolq-text-dim)">{STATUS_LABEL[status]}</span>
                    {stats && (
                      <span className={`ml-auto text-[18px] font-medium ${TONE[latencyTone(stats.last)]}`}>
                        {stats.last} ms
                      </span>
                    )}
                  </div>
                  {stats && (
                    <div className="flex items-center gap-4 text-(--dolq-accent)">
                      <Sparkline
                        values={samples.map((x) => x.ms)}
                        label={`Latency to ${s.name} over time, ${stats.last} ms now`}
                        width={240}
                      />
                      <span className="text-[12px] text-(--dolq-text-dim)">
                        min {stats.min} · avg {stats.avg} · max {stats.max} ms
                      </span>
                    </div>
                  )}
                  {status === 'connected' && stats === null && (
                    <span className="text-[13px] text-(--dolq-text-faint)">Measuring latency…</span>
                  )}
                  {joined.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {joined.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => onOpenChannel(s.id, c.id)}
                          className="h-6.5 cursor-pointer rounded-full border border-(--dolq-border-strong) bg-transparent px-2.5 text-[13px] text-(--dolq-text) hover:bg-(--dolq-bg-row-hover)"
                        >
                          #{c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
