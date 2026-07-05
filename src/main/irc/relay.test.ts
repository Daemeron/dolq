import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Relay } from './relay';
import type net from 'net';

function makeServer() {
  return new EventEmitter();
}

function makeSocket() {
  const emitter = new EventEmitter();
  const write = vi.fn();
  const destroy = vi.fn();
  return Object.assign(emitter, { write, destroy });
}

describe('Relay.start()', () => {
  it('adds a connecting socket to the connection set', () => {
    const server = makeServer();
    const relay = new Relay(server as net.Server);
    relay.start();

    const socket = makeSocket();
    server.emit('connection', socket);

    relay.relay('TEST');
    expect(socket.write).toHaveBeenCalledWith('TEST\r\n');
  });

  it('removes a socket from the set when it closes', () => {
    const server = makeServer();
    const relay = new Relay(server as net.Server);
    relay.start();

    const socket = makeSocket();
    server.emit('connection', socket);
    socket.emit('close');

    relay.relay('TEST');
    expect(socket.write).not.toHaveBeenCalled();
  });

  it('removes and destroys a socket when it errors', () => {
    const server = makeServer();
    const relay = new Relay(server as net.Server);
    relay.start();

    const socket = makeSocket();
    server.emit('connection', socket);
    socket.emit('error', new Error('connection reset'));

    relay.relay('TEST');
    expect(socket.write).not.toHaveBeenCalled();
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('handles multiple simultaneous connections', () => {
    const server = makeServer();
    const relay = new Relay(server as net.Server);
    relay.start();

    const s1 = makeSocket();
    const s2 = makeSocket();
    server.emit('connection', s1);
    server.emit('connection', s2);

    relay.relay('HELLO');
    expect(s1.write).toHaveBeenCalledWith('HELLO\r\n');
    expect(s2.write).toHaveBeenCalledWith('HELLO\r\n');
  });
});

describe('Relay.relay()', () => {
  it('appends \\r\\n to the relayed message', () => {
    const server = makeServer();
    const relay = new Relay(server as net.Server);
    relay.start();

    const socket = makeSocket();
    server.emit('connection', socket);

    relay.relay(':server 001 nick :Welcome');
    expect(socket.write).toHaveBeenCalledWith(':server 001 nick :Welcome\r\n');
  });

  it('does nothing when there are no connections', () => {
    const server = makeServer();
    const relay = new Relay(server as net.Server);
    relay.start();

    // Should not throw
    expect(() => relay.relay('PING')).not.toThrow();
  });
});
