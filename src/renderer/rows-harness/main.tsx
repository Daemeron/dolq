import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/newsreader/wght.css';
import '@fontsource/jetbrains-mono/400.css';
import ReactDOM from 'react-dom/client';
import { MessageArea } from '../src/components/MessageArea';
import type { Message } from '../src/types';
import '../src/index.css';

// A page for e2e/rowSizes.e2e.ts: the message list with a line, a folded run of joins, then another line.
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
  const isLog = new URLSearchParams(location.search).has('log');
  ReactDOM.createRoot(root).render(
    <MessageArea messages={messages} isLog={isLog} channelId="c1" timestampFormat="12h" density="cozy" selfNick="me" />,
  );
}
