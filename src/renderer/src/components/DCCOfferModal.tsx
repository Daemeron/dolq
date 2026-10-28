import { useEffect } from 'react';
import { Button, Card, Setting } from './ui';
import { ViewPanel } from './ViewPanel';

type Props = {
  nick: string;
  onAccept: () => void;
  onDecline: () => void;
};

export function DCCOfferModal({ nick, onAccept, onDecline }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onDecline();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDecline]);

  return (
    <ViewPanel
      title="DCC chat request"
      description="Only accept this from someone you trust. It connects straight to their address."
      width="sm"
      onClose={onDecline}
      footer={
        <>
          <Button onClick={onDecline}>Decline</Button>
          <Button variant="primary" onClick={onAccept}>
            Accept
          </Button>
        </>
      }
    >
      <Card className="border-(--dolq-accent) bg-(--dolq-accent-soft)">
        <Setting title={`${nick} wants to chat`} description="A direct chat outside the server." />
      </Card>
    </ViewPanel>
  );
}
