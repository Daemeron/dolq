import { ContextMenu, ContextMenuHeader, ContextMenuItem } from './ContextMenu';

/** What a person's nick can be used for wherever it appears, in the member list or in a conversation. */
export type NickActions = {
  /** Connected to the server, so a nick can be messaged or asked about; everything but ignoring is a request. */
  canAsk: boolean;
  currentNick?: string;
  onOpenQuery?: (nick: string) => void;
  onWhois: (nick: string) => void;
  ignoredNicks: string[];
  onToggleIgnore: (nick: string) => void;
  onDCCOffer: (nick: string) => void;
  onSendFile: (nick: string) => void;
};

/** What a click on a nick does: open a conversation with that person, unless it is the user's own or there is no server. */
export function queryOnClick({ canAsk, currentNick, onOpenQuery }: NickActions, nick: string) {
  return nick === currentNick || !canAsk || !onOpenQuery ? undefined : () => onOpenQuery(nick);
}

type Props = {
  x: number;
  y: number;
  nick: string;
  actions: NickActions;
  close: () => void;
};

/** The menu of a nick: the same one wherever the nick is right-clicked. */
export function NickMenu({ x, y, nick, actions, close }: Props) {
  const ignored = actions.ignoredNicks.includes(nick);
  const run = (action: (nick: string) => void) => () => {
    action(nick);
    close();
  };
  return (
    <ContextMenu x={x} y={y}>
      <ContextMenuHeader>{nick}</ContextMenuHeader>
      {actions.canAsk && (
        <>
          <ContextMenuItem onClick={run(actions.onWhois)}>WHOIS</ContextMenuItem>
          <ContextMenuItem onClick={run(actions.onDCCOffer)}>DCC Chat</ContextMenuItem>
          <ContextMenuItem onClick={run(actions.onSendFile)}>Send File…</ContextMenuItem>
        </>
      )}
      <ContextMenuItem danger={!ignored} onClick={run(actions.onToggleIgnore)}>
        {ignored ? 'Unignore' : 'Ignore'}
      </ContextMenuItem>
    </ContextMenu>
  );
}
