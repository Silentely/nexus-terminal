import WebSocket from 'ws';
import { AuthenticatedWebSocket, ClientState, DockerContainer, DockerStats } from '../types';
import { parsePortsString, sendWsMessage } from '../utils';
import { clientStates, settingsService } from '../state';
import { getErrorMessage } from '../../utils/AppError';
import { sanitizeDockerContainerId, isValidDockerCommand } from '../../utils/docker-security';
import { logger } from '../../utils/logger';

const DEFAULT_DOCKER_STATUS_INTERVAL_SECONDS = 2;

// Docker 命令执行后等待容器状态同步的延迟（毫秒）
// 短暂延迟确保 Docker daemon 已完成状态变更，避免读取到旧状态
const DOCKER_STATUS_SYNC_DELAY_MS = 500;

// 会话级轮询重入保护：防止慢轮询导致叠加执行
const dockerPollInFlightSessions = new Set<string>();

type DockerCommandAction = 'start' | 'stop' | 'restart' | 'remove';

interface DockerCommandPayload {
  containerId?: string;
  command?: DockerCommandAction;
}

interface DockerStatsPayload {
  containerId?: string;
}

const parseDockerCommandPayload = (payload: unknown): DockerCommandPayload => {
  if (typeof payload !== 'object' || payload === null) {
    return {};
  }

  const data = payload as Record<string, unknown>;
  const containerId = typeof data.containerId === 'string' ? data.containerId : undefined;
  const command =
    data.command === 'start' ||
    data.command === 'stop' ||
    data.command === 'restart' ||
    data.command === 'remove'
      ? data.command
      : undefined;

  return { containerId, command };
};

const parseDockerStatsPayload = (payload: unknown): DockerStatsPayload => {
  if (typeof payload !== 'object' || payload === null) {
    return {};
  }

  const data = payload as Record<string, unknown>;
  const containerId = typeof data.containerId === 'string' ? data.containerId : undefined;
  return { containerId };
};

export async function fetchRemoteDockerStatus(
  state: ClientState,
): Promise<{ available: boolean; containers: DockerContainer[] }> {
  if (!state || !state.sshClient) {
    logger.warn(
      `[fetchRemoteDockerStatus] SSH client not available or not connected for session ${state?.ws?.sessionId}.`,
    );
    return { available: false, containers: [] };
  }

  let allContainers: DockerContainer[] = [];
  const statsMap = new Map<string, DockerStats>();

  try {
    const versionCommand = "docker version --format '{{.Server.Version}}'";
    const { stdout: versionStdout, stderr: versionStderr } = await new Promise<{
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      if (!state.sshClient) {
        return reject(new Error('SSH client disconnected before command execution.'));
      }
      state.sshClient.exec(versionCommand, { pty: false }, (err, stream) => {
        if (err) return reject(err);
        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
        stream.on('close', () => resolve({ stdout, stderr }));
        stream.on('error', (execErr: Error) => reject(execErr));
      });
    });

    if (
      versionStderr.includes('command not found') ||
      versionStderr.includes('permission denied') ||
      versionStderr.includes('Cannot connect to the Docker daemon')
    ) {
      logger.warn(
        `[fetchRemoteDockerStatus] Docker version check failed on session ${state.ws.sessionId}. Docker unavailable or inaccessible. Stderr: ${versionStderr.trim()}`,
      );
      return { available: false, containers: [] };
    }
    if (versionStderr) {
      logger.warn(
        `[fetchRemoteDockerStatus] Docker version command stderr on session ${state.ws.sessionId}: ${versionStderr.trim()}`,
      );
    }

    if (!versionStdout.trim()) {
      logger.warn(
        `[fetchRemoteDockerStatus] Docker version check on session ${state.ws.sessionId} produced no output, assuming Docker unavailable.`,
      );
      return { available: false, containers: [] };
    }
  } catch (error: unknown) {
    logger.error(
      `[fetchRemoteDockerStatus] Error executing docker version for session ${state.ws.sessionId}:`,
      getErrorMessage(error),
    );
    return { available: false, containers: [] };
  }

  try {
    const psCommand = "docker ps -a --no-trunc --format '{{json .}}'";
    const { stdout: psStdout, stderr: psStderr } = await new Promise<{
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      if (!state.sshClient) {
        return reject(new Error('SSH client disconnected before command execution.'));
      }
      state.sshClient.exec(psCommand, { pty: false }, (err, stream) => {
        if (err) return reject(err);
        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
        stream.on('close', () => resolve({ stdout, stderr }));
        stream.on('error', (execErr: Error) => reject(execErr));
      });
    });

    if (
      psStderr.includes('command not found') ||
      psStderr.includes('permission denied') ||
      psStderr.includes('Cannot connect to the Docker daemon')
    ) {
      logger.warn(
        `[fetchRemoteDockerStatus] Docker ps command failed unexpectedly after version check on session ${state.ws.sessionId}. Stderr: ${psStderr.trim()}`,
      );
      return { available: false, containers: [] };
    }
    if (psStderr) {
      logger.warn(
        `[fetchRemoteDockerStatus] Docker ps command stderr on session ${state.ws.sessionId}: ${psStderr.trim()}`,
      );
    }

    const lines = psStdout.trim() ? psStdout.trim().split('\n') : [];
    allContainers = lines
      .map((line) => {
        try {
          const data = JSON.parse(line);
          const container: DockerContainer = {
            id: data.ID,
            Names: typeof data.Names === 'string' ? data.Names.split(',') : data.Names || [],
            Image: data.Image || '',
            ImageID: data.ImageID || '',
            Command: data.Command || '',
            Created: data.CreatedAt || 0,
            State: data.State || 'unknown',
            Status: data.Status || '',
            Ports: parsePortsString(data.Ports),
            Labels: data.Labels || {},
            stats: null,
          };
          return container;
        } catch (parseError: unknown) {
          logger.error(
            `[fetchRemoteDockerStatus] Failed to parse container JSON line for session ${state.ws.sessionId}: ${line} (${getErrorMessage(parseError)})`,
          );
          return null;
        }
      })
      .filter((container): container is DockerContainer => container !== null);
  } catch (error: unknown) {
    logger.error(
      `[fetchRemoteDockerStatus] Error executing docker ps for session ${state.ws.sessionId}:`,
      getErrorMessage(error),
    );
    return { available: false, containers: [] };
  }

  const runningContainerIds = allContainers.filter((c) => c.State === 'running').map((c) => c.id);

  if (runningContainerIds.length > 0) {
    try {
      // 净化所有 containerIds，仅允许安全字符（命令注入防护）
      const cleanContainerIds = runningContainerIds
        .map((id) => sanitizeDockerContainerId(id))
        .filter((id) => id.length > 0);

      if (cleanContainerIds.length === 0) {
        logger.warn(
          `[fetchRemoteDockerStatus] All running container IDs failed sanitization for session ${state.ws.sessionId}.`,
        );
        return { available: true, containers: allContainers }; // Return containers without stats
      }

      const statsCommand = `docker stats ${cleanContainerIds.join(' ')} --no-stream --format '{{json .}}'`;
      const { stdout: statsStdout, stderr: statsStderr } = await new Promise<{
        stdout: string;
        stderr: string;
      }>((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        if (!state.sshClient) {
          return reject(new Error('SSH client disconnected before command execution.'));
        }
        state.sshClient.exec(statsCommand, { pty: false }, (err, stream) => {
          if (err) return reject(err);
          stream.on('data', (data: Buffer) => {
            stdout += data.toString();
          });
          stream.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });
          stream.on('close', () => resolve({ stdout, stderr }));
          stream.on('error', (execErr: Error) => reject(execErr));
        });
      });

      if (statsStderr) {
        logger.warn(
          `[fetchRemoteDockerStatus] Docker stats command stderr on session ${state.ws.sessionId}: ${statsStderr.trim()}`,
        );
      }

      const statsLines = statsStdout.trim() ? statsStdout.trim().split('\n') : [];
      statsLines.forEach((line) => {
        try {
          const statsData = JSON.parse(line) as DockerStats;
          if (statsData.ID) {
            statsMap.set(statsData.ID, statsData);
          }
        } catch (parseError: unknown) {
          logger.error(
            `[fetchRemoteDockerStatus] Failed to parse stats JSON line for session ${state.ws.sessionId}: ${line} (${getErrorMessage(parseError)})`,
          );
        }
      });
    } catch (error: unknown) {
      logger.warn(
        `[fetchRemoteDockerStatus] Error executing docker stats for session ${state.ws.sessionId}:`,
        getErrorMessage(error),
      );
    }
  }

  allContainers.forEach((container) => {
    const shortId = container.id.substring(0, 12);
    const stats = statsMap.get(container.id) || statsMap.get(shortId);
    if (stats) {
      container.stats = stats;
    }
  });

  return { available: true, containers: allContainers };
}

export async function handleDockerGetStatus(
  ws: AuthenticatedWebSocket,
  sessionId: string | undefined,
): Promise<void> {
  const state = sessionId ? clientStates.get(sessionId) : undefined;
  if (!state) {
    logger.warn(
      `WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 docker:get_status 请求，但无活动会话状态。`,
    );
    sendWsMessage(ws, 'docker:status:error', { message: 'Session state not found.' }, sessionId);
    return;
  }
  if (!state.sshClient) {
    logger.warn(
      `WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 docker:get_status 请求，但无活动 SSH 连接。`,
    );
    sendWsMessage(ws, 'docker:status:error', { message: 'SSH connection not active.' }, sessionId);
    return;
  }
  try {
    const statusPayload = await fetchRemoteDockerStatus(state);
    sendWsMessage(ws, 'docker:status:update', statusPayload, sessionId);
  } catch (error: unknown) {
    logger.error(`WebSocket: 手动执行远程 Docker 状态命令失败 for session ${sessionId}:`, error);
    const errorMessage = getErrorMessage(error) || 'Unknown error fetching status';
    const isUnavailable =
      errorMessage.includes('command not found') ||
      errorMessage.includes('Cannot connect to the Docker daemon');
    if (isUnavailable) {
      sendWsMessage(ws, 'docker:status:update', { available: false, containers: [] }, sessionId);
    } else {
      sendWsMessage(
        ws,
        'docker:status:error',
        { message: `Failed to get remote Docker status: ${errorMessage}` },
        sessionId,
      );
    }
  }
}

export async function handleDockerCommand(
  ws: AuthenticatedWebSocket,
  sessionId: string | undefined,
  payload: unknown,
): Promise<void> {
  const commandPayload = parseDockerCommandPayload(payload);
  const state = sessionId ? clientStates.get(sessionId) : undefined;
  if (!state || !state.sshClient) {
    logger.warn(
      `WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 docker:command 请求，但无活动 SSH 连接。`,
    );
    sendWsMessage(
      ws,
      'docker:command:error',
      { command: commandPayload.command, message: 'SSH connection not active.' },
      sessionId,
    );
    return;
  }
  const { containerId, command } = commandPayload;
  if (
    !containerId ||
    typeof containerId !== 'string' ||
    !command ||
    !['start', 'stop', 'restart', 'remove'].includes(command)
  ) {
    logger.error(
      `WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的无效 docker:command 请求。Payload:`,
      payload,
    );
    sendWsMessage(
      ws,
      'docker:command:error',
      { command, message: 'Invalid containerId or command.' },
      sessionId,
    );
    return;
  }

  logger.debug(
    `WebSocket: Processing command '${command}' for container '${containerId}' on session ${sessionId}...`,
  );
  try {
    const cleanContainerId = sanitizeDockerContainerId(containerId);
    if (!cleanContainerId) throw new Error('Invalid container ID format after sanitization.');

    if (!isValidDockerCommand(command)) {
      throw new Error(`Unsupported command: ${command}`);
    }

    let dockerCliCommand: string;
    switch (command) {
      case 'start':
        dockerCliCommand = `docker start ${cleanContainerId}`;
        break;
      case 'stop':
        dockerCliCommand = `docker stop ${cleanContainerId}`;
        break;
      case 'restart':
        dockerCliCommand = `docker restart ${cleanContainerId}`;
        break;
      case 'remove':
        dockerCliCommand = `docker rm -f ${cleanContainerId}`;
        break;
    }

    await new Promise<void>((resolve, reject) => {
      if (!state.sshClient) {
        return reject(new Error('SSH client disconnected before command execution.'));
      }
      state.sshClient.exec(dockerCliCommand, { pty: false }, (err, stream) => {
        if (err) return reject(err);
        let stderr = '';
        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
        stream.on('close', (code: number | null) => {
          if (code === 0) {
            logger.info(
              `WebSocket: 远程 Docker 命令 (${dockerCliCommand}) on session ${sessionId} 执行成功。`,
            );
            resolve();
          } else {
            logger.error(
              `WebSocket: 远程 Docker 命令 (${dockerCliCommand}) on session ${sessionId} 执行失败 (Code: ${code}). Stderr: ${stderr}`,
            );
            reject(new Error(`Command failed with code ${code}. ${stderr || 'No stderr output.'}`));
          }
        });
        stream.on('error', (execErr: Error) => reject(execErr));
      });
    });

    // Request a status update after a short delay
    setTimeout(() => {
      if (!sessionId) {
        return;
      }
      const currentState = clientStates.get(sessionId); // Re-fetch state as it might have changed
      if (currentState && currentState.ws.readyState === WebSocket.OPEN) {
        sendWsMessage(currentState.ws, 'request_docker_status_update', {}, sessionId);
      }
    }, DOCKER_STATUS_SYNC_DELAY_MS);
  } catch (error: unknown) {
    logger.error(
      `WebSocket: 执行远程 Docker 命令 (${command} for ${containerId}) 失败 for session ${sessionId}:`,
      error,
    );
    sendWsMessage(
      ws,
      'docker:command:error',
      {
        command,
        containerId,
        message: `Failed to execute remote command: ${getErrorMessage(error)}`,
      },
      sessionId,
    );
  }
}

export async function handleDockerGetStats(
  ws: AuthenticatedWebSocket,
  sessionId: string | undefined,
  payload: unknown,
): Promise<void> {
  const state = sessionId ? clientStates.get(sessionId) : undefined;
  if (!state || !state.sshClient) {
    logger.warn(
      `WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 docker:get_stats 请求，但无活动 SSH 连接。`,
    );
    sendWsMessage(
      ws,
      'docker:stats:error',
      {
        containerId: parseDockerStatsPayload(payload).containerId,
        message: 'SSH connection not active.',
      },
      sessionId,
    );
    return;
  }
  const { containerId } = parseDockerStatsPayload(payload);
  if (!containerId) {
    logger.warn(
      `WebSocket: Invalid payload for docker:get_stats in session ${sessionId}:`,
      payload,
    );
    sendWsMessage(
      ws,
      'docker:stats:error',
      { containerId, message: 'Missing containerId.' },
      sessionId,
    );
    return;
  }

  // 净化 containerId，仅允许安全字符（命令注入防护）
  const cleanContainerId = sanitizeDockerContainerId(containerId);
  if (!cleanContainerId) {
    logger.error(
      `WebSocket: Invalid container ID format after sanitization for session ${sessionId}: ${containerId}`,
    );
    sendWsMessage(
      ws,
      'docker:stats:error',
      { containerId, message: 'Invalid container ID format.' },
      sessionId,
    );
    return;
  }

  logger.debug(
    `WebSocket: Handling docker:get_stats for container ${cleanContainerId} in session ${sessionId}`,
  );
  const command = `docker stats ${cleanContainerId} --no-stream --format '{{json .}}'`;

  try {
    const execResult = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      if (!state.sshClient) {
        return reject(new Error('SSH client disconnected before command execution.'));
      }
      state.sshClient.exec(command, { pty: false }, (err, stream) => {
        if (err) return reject(err);
        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
        stream.on('close', () => resolve({ stdout, stderr }));
        stream.on('error', (execErr: Error) => reject(execErr));
      });
    });

    if (execResult.stderr) {
      logger.error(
        `WebSocket: Docker stats stderr for ${containerId} in session ${sessionId}: ${execResult.stderr}`,
      );
      sendWsMessage(
        ws,
        'docker:stats:error',
        {
          containerId,
          message: execResult.stderr.trim() || 'Error executing stats command.',
        },
        sessionId,
      );
      return;
    }

    if (!execResult.stdout) {
      logger.warn(
        `WebSocket: No stats output for container ${containerId} in session ${sessionId}. Might be stopped or error occurred.`,
      );
      if (!execResult.stderr) {
        sendWsMessage(
          ws,
          'docker:stats:error',
          {
            containerId,
            message: 'No stats data received (container might be stopped).',
          },
          sessionId,
        );
      }
      return;
    }

    try {
      const statsData = JSON.parse(execResult.stdout.trim());
      sendWsMessage(ws, 'docker:stats:update', { containerId, stats: statsData }, sessionId);
    } catch (parseError: unknown) {
      logger.error(
        `WebSocket: Failed to parse docker stats JSON for ${containerId} in session ${sessionId}: ${execResult.stdout} (${getErrorMessage(parseError)})`,
      );
      sendWsMessage(
        ws,
        'docker:stats:error',
        { containerId, message: 'Failed to parse stats data.' },
        sessionId,
      );
    }
  } catch (error: unknown) {
    logger.error(
      `WebSocket: Failed to execute docker stats for ${containerId} in session ${sessionId}:`,
      error,
    );
    sendWsMessage(
      ws,
      'docker:stats:error',
      {
        containerId,
        message: getErrorMessage(error) || 'Failed to fetch Docker stats.',
      },
      sessionId,
    );
  }
}

export async function startDockerStatusPolling(sessionId: string): Promise<void> {
  const state = clientStates.get(sessionId);
  if (!state) {
    logger.warn(`[Docker Polling] Cannot start polling for non-existent session ${sessionId}`);
    return;
  }

  logger.debug(`WebSocket: 会话 ${sessionId} 正在启动 Docker 状态轮询...`);
  let dockerPollIntervalMs = DEFAULT_DOCKER_STATUS_INTERVAL_SECONDS * 1000;
  try {
    const intervalSetting = await settingsService.getSetting('dockerStatusIntervalSeconds');
    if (intervalSetting) {
      const intervalSeconds = parseInt(intervalSetting, 10);
      if (!Number.isNaN(intervalSeconds) && intervalSeconds >= 1) {
        dockerPollIntervalMs = intervalSeconds * 1000;
        logger.debug(
          `[Docker Polling] Using interval from settings: ${intervalSeconds}s (${dockerPollIntervalMs}ms) for session ${sessionId}`,
        );
      } else {
        logger.warn(
          `[Docker Polling] Invalid interval setting '${intervalSetting}' found. Using default ${dockerPollIntervalMs}ms for session ${sessionId}`,
        );
      }
    } else {
      logger.debug(
        `[Docker Polling] No interval setting found. Using default ${dockerPollIntervalMs}ms for session ${sessionId}`,
      );
    }
  } catch (settingError: unknown) {
    logger.error(
      `[Docker Polling] Error fetching interval setting for session ${sessionId}. Using default ${dockerPollIntervalMs}ms: ${getErrorMessage(settingError)}`,
    );
  }

  // Clear existing interval if any, to prevent multiple pollers for the same session
  if (state.dockerStatusIntervalId) {
    clearInterval(state.dockerStatusIntervalId);
    logger.debug(
      `[Docker Polling] Cleared existing Docker status interval for session ${sessionId}.`,
    );
  }

  const dockerIntervalId = setInterval(async () => {
    const currentState = clientStates.get(sessionId); // Re-fetch state in case it changed (e.g., disconnected)
    if (!currentState || currentState.ws.readyState !== WebSocket.OPEN || !currentState.sshClient) {
      logger.debug(
        `[Docker Polling] Session ${sessionId} no longer valid, WS closed, or SSH disconnected. Stopping poll.`,
      );
      clearInterval(dockerIntervalId);
      if (currentState && currentState.dockerStatusIntervalId === dockerIntervalId) {
        delete currentState.dockerStatusIntervalId;
      }
      dockerPollInFlightSessions.delete(sessionId);
      return;
    }
    // 重入保护：如果上一次轮询尚未完成，跳过本次
    if (dockerPollInFlightSessions.has(sessionId)) {
      return;
    }
    dockerPollInFlightSessions.add(sessionId);
    try {
      const statusPayload = await fetchRemoteDockerStatus(currentState);
      sendWsMessage(currentState.ws, 'docker:status:update', statusPayload, sessionId);
    } catch (error: unknown) {
      logger.error(
        `[Docker Polling] Error fetching Docker status for session ${sessionId}:`,
        getErrorMessage(error),
      );
    } finally {
      dockerPollInFlightSessions.delete(sessionId);
    }
  }, dockerPollIntervalMs);
  state.dockerStatusIntervalId = dockerIntervalId;

  // Initial fetch（复用 in-flight guard 防止与首个 interval tick 竞态）
  const initialState = clientStates.get(sessionId);
  if (initialState && initialState.ws.readyState === WebSocket.OPEN && initialState.sshClient) {
    if (!dockerPollInFlightSessions.has(sessionId)) {
      dockerPollInFlightSessions.add(sessionId);
      logger.debug(`[Docker Initial Fetch] Fetching status for session ${sessionId}...`);
      try {
        const statusPayload = await fetchRemoteDockerStatus(initialState);
        sendWsMessage(initialState.ws, 'docker:status:update', statusPayload, sessionId);
      } catch (error: unknown) {
        logger.error(
          `[Docker Initial Fetch] Error fetching Docker status for session ${sessionId}:`,
          getErrorMessage(error),
        );
        if (initialState.ws.readyState === WebSocket.OPEN) {
          const errorMessage = getErrorMessage(error) || 'Unknown error during initial fetch';
          const isUnavailable =
            errorMessage.includes('command not found') ||
            errorMessage.includes('Cannot connect to the Docker daemon');
          if (isUnavailable) {
            sendWsMessage(
              initialState.ws,
              'docker:status:update',
              { available: false, containers: [] },
              sessionId,
            );
          } else {
            sendWsMessage(
              initialState.ws,
              'docker:status:error',
              { message: `Initial Docker status fetch failed: ${errorMessage}` },
              sessionId,
            );
          }
        }
      } finally {
        dockerPollInFlightSessions.delete(sessionId);
      }
    }
  }
}
