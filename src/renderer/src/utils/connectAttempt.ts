type Status = 'disconnected' | 'connecting' | 'connected';

// Runs a connect and keeps the status honest: a failed dial must not leave the
// server stuck on "connecting". Returns the error text, or null on success.
export async function attemptConnect(
  serverId: string,
  setStatus: (serverId: string, status: Status) => void,
  connect: () => Promise<unknown>,
): Promise<string | null> {
  setStatus(serverId, 'connecting');
  try {
    await connect();
  } catch (err) {
    setStatus(serverId, 'disconnected');
    return err instanceof Error ? err.message : String(err);
  }
  setStatus(serverId, 'connected');
  return null;
}
