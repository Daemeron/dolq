import { useState } from 'react';
import { fileNumber, loadPackRequests, type PackBatch, PackListError, toBatches } from '../utils/packlist';
import { IconButton } from './Icon';
import { Button, Card, inputClass } from './ui';

export type QueuedBatch = PackBatch & { id: number; serverId: string };

type Props = {
  serverName: string;
  queue: QueuedBatch[];
  fetchPage: (url: string) => Promise<string>;
  onQueue: (batches: PackBatch[]) => void;
  onRemove: (id: number) => void;
  onClear: () => void;
};

// Pulls the "/msg Bot xdcc send #N" lines out of a packlist page and sends the bots one batch request each.
export function PackQueue({ serverName, queue, fetchPage, onQueue, onRemove, onClear }: Props) {
  const [url, setUrl] = useState('');
  const [start, setStart] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [found, setFound] = useState<PackBatch[] | null>(null);

  async function load(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFound(null);
    try {
      const min = Number(start) || 0;
      const requests = await loadPackRequests(url.trim(), fetchPage);
      // A file with no number in its name cannot be placed, so it is left out once a start is given.
      const batches = toBatches(requests.filter((r) => !min || (fileNumber(r.name) ?? 0) >= min));
      if (batches.length === 0)
        setError(`None of the ${requests.length} files on that page have a number of ${min} or higher in their name.`);
      else setFound(batches);
    } catch (err) {
      setError(
        err instanceof PackListError
          ? err.message
          : `Could not read the page: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  const packCount = (batches: PackBatch[]) => batches.reduce((n, b) => n + b.count, 0);

  return (
    <section className="mb-4" aria-label="Packlist queue">
      <form onSubmit={load} className="flex items-center gap-2">
        <input
          className={inputClass}
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Packlist page link, https://…"
          aria-label="Packlist link"
        />
        <input
          className={`${inputClass} w-32! shrink-0`}
          type="number"
          min={1}
          value={start}
          onChange={(e) => setStart(e.target.value)}
          placeholder="From file no."
          aria-label="First file number"
        />
        <Button type="submit" disabled={busy || !url.trim()}>
          {busy ? 'Reading…' : 'Find packs'}
        </Button>
      </form>
      {error && (
        <div role="alert" className="mt-2 text-[13px] text-(--dolq-danger)">
          {error}
        </div>
      )}
      {found && (
        <div className="mt-2 flex items-center justify-between gap-3 text-[13px] text-(--dolq-text-dim)">
          <span>
            {packCount(found)} packs from {new Set(found.map((b) => b.bot.toLowerCase())).size} bots, one batch request
            each, sent on {serverName}.
          </span>
          <Button
            variant="primary"
            small
            onClick={() => {
              onQueue(found);
              setFound(null);
              setUrl('');
              setStart('');
            }}
          >
            Queue requests
          </Button>
        </div>
      )}
      {queue.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[13px] text-(--dolq-text-dim)">
            <span>Requests waiting to be sent</span>
            <Button variant="ghost" small onClick={onClear}>
              Clear
            </Button>
          </div>
          <Card>
            {queue.map((b) => (
              <div key={b.id} className="flex items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1 truncate text-[13px] text-(--dolq-text)">
                  <span className="font-medium">{b.bot}</span>{' '}
                  <span className="font-mono text-(--dolq-text-dim)">xdcc batch {b.spec}</span>
                </div>
                <IconButton icon="close" label={`Remove ${b.bot}`} onClick={() => onRemove(b.id)} />
              </div>
            ))}
          </Card>
        </div>
      )}
    </section>
  );
}
