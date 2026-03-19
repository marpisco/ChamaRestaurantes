interface WsUrlEnv {
  VITE_WS_URL?: string;
  VITE_WS_PORT?: string;
}

export function resolveWebSocketUrl(
  env: WsUrlEnv,
  locationLike: Pick<Location, 'protocol' | 'host' | 'hostname'> | URL,
): string {
  const explicitUrl = env.VITE_WS_URL?.trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  const protocol = locationLike.protocol === 'https:' ? 'wss' : 'ws';
  const backendPort = env.VITE_WS_PORT?.trim();

  if (backendPort) {
    return `${protocol}://${locationLike.hostname}:${backendPort}/ws`;
  }

  return `${protocol}://${locationLike.host}/ws`;
}
