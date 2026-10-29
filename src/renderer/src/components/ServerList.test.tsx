import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionStatus } from '../../../shared/ipc';
import type { Server } from '../types';
import { ServerList } from './ServerList';

const server = (id: string, name: string): Server =>
  ({ id, name, initial: name[0], host: `${id}.example`, port: 6697 }) as Server;

function renderList(statusMap: Record<string, ConnectionStatus>) {
  const props = {
    servers: [server('a', 'Alpha'), server('b', 'Beta')],
    selectedId: 'a',
    onSelect: vi.fn(),
    onAddServer: vi.fn(),
    onRemove: vi.fn(),
    onEditServer: vi.fn(),
    statusMap,
    onToggleConnection: vi.fn(),
    onOpenPreferences: vi.fn(),
  };
  render(<ServerList {...props} />);
  return props;
}

describe('ServerList connection badge', () => {
  it('labels each server badge with its connection state, treating unknown as disconnected', () => {
    renderList({ a: 'connected', b: 'connecting' });
    expect(screen.getByLabelText('Connected').getAttribute('data-tip')).toBe('Connected');
    expect(screen.getByLabelText('Connecting…')).toBeTruthy();

    // A server missing from the map is shown disconnected.
    renderList({});
    expect(screen.getAllByLabelText('Disconnected').length).toBe(2);
  });

  it('opens preferences from the bottom of the rail', () => {
    const { onOpenPreferences } = renderList({});
    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    expect(onOpenPreferences).toHaveBeenCalled();
  });

  it('selects a server on click', () => {
    const { onSelect } = renderList({});
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('offers Connect for a disconnected server and Disconnect for a connected one', () => {
    const { onToggleConnection } = renderList({ a: 'connected' });

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Alpha' }));
    fireEvent.click(screen.getByText('Disconnect'));
    expect(onToggleConnection).toHaveBeenCalledWith('a');

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Beta' }));
    fireEvent.click(screen.getByText('Connect'));
    expect(onToggleConnection).toHaveBeenCalledWith('b');
  });

  it('adds a server from the plus button', () => {
    const { onAddServer } = renderList({});
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }));
    expect(onAddServer).toHaveBeenCalled();
  });

  it('edits and removes a server from its menu', () => {
    const { onEditServer, onRemove } = renderList({});
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Alpha' }));
    fireEvent.click(screen.getByText('Edit Server…'));
    expect(onEditServer).toHaveBeenCalledWith('a');
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Beta' }));
    fireEvent.click(screen.getByText('Remove Server'));
    expect(onRemove).toHaveBeenCalledWith('b');
  });

  it('draws each icon from the server colour and letters, else from its id and name', () => {
    render(
      <ServerList
        servers={[{ ...server('a', 'Alpha'), color: '#112233', initials: 'ALP' }, server('b', 'Beta Net')]}
        selectedId="a"
        onSelect={vi.fn()}
        onAddServer={vi.fn()}
        onRemove={vi.fn()}
        onEditServer={vi.fn()}
        statusMap={{}}
        onToggleConnection={vi.fn()}
        onOpenPreferences={vi.fn()}
      />,
    );
    const alpha = screen.getByRole('button', { name: 'Alpha' });
    expect(alpha).toHaveTextContent('ALP');
    expect(alpha.style.background).toContain('rgb(17, 34, 51)');
    const beta = screen.getByRole('button', { name: 'Beta Net' });
    expect(beta).toHaveTextContent('BN');
    expect(beta.style.background).toContain('--dolq-nick-');
  });
});
