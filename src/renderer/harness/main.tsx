import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/newsreader/wght.css';
import '@fontsource/jetbrains-mono/400.css';
import ReactDOM from 'react-dom/client';
import { BandwidthChart } from '../src/components/BandwidthChart';
import { MessageArea } from '../src/components/MessageArea';
import type { Message } from '../src/types';
import '../src/index.css';

// Pages for the browser tests in e2e/. ?chart is the dashboard's bandwidth chart; otherwise the message list with a line, a
// folded run of joins, then another line.
const at = new Date(2026, 10, 15, 5, 0);
const join = (id: number): Message => ({
  id,
  nick: '',
  text: `user${id} joined`,
  timestamp: at,
  system: true,
  membership: 'join',
});
const messages: Message[] = [
  { id: 0, nick: 'mira', text: 'hi', timestamp: at, isRaw: true },
  join(1),
  join(2),
  join(3),
  { id: 4, nick: 'mira', text: 'hello', timestamp: at, isRaw: true },
];

const root = document.getElementById('root');
if (root) {
  const params = new URLSearchParams(location.search);
  ReactDOM.createRoot(root).render(
    params.has('chart') ? (
      <div style={{ width: 800 }}>
        <BandwidthChart
          samples={[
            { at: 0, down: 10, up: 5 },
            { at: 1, down: 20, up: 8 },
          ]}
        />
      </div>
    ) : (
      <MessageArea
        messages={messages}
        isLog={params.has('log')}
        channelId="c1"
        timestampFormat="12h"
        density="cozy"
        selfNick="me"
      />
    ),
  );
}
