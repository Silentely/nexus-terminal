import WebSocket from 'ws';
import { AuthenticatedWebSocket, ClientState, DockerContainer, DockerStats } from '../types';
import { parsePortsString } from '../utils';
import { clientStates, settingsService } from '../state';

const DEFAULT_DOCKER_STATUS_INTERVAL_SECONDS = 2;

export async function fetchRemoteDockerStatus(
  state: ClientState
): Promise<{ available: boolean; containers: DockerContainer[] }> {
  if (!state || !state.sshClient) {
    console.warn(
      `[fetchRemoteDockerStatus] SSH client not available or not connected for session ${state?.ws?.sessionId}.`
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
      console.warn(
        `[fetchRemoteDockerStatus] Docker version check failed on session ${state.ws.sessionId}. Docker unavailable or inaccessible. Stderr: ${versionStderr.trim()}`
      );
      return { available: false, containers: [] };
    }
    if (versionStderr) {
      console.warn(
        `[fetchRemoteDockerStatus] Docker version command stderr on session ${state.ws.sessionId}: ${versionStderr.trim()}`
      );
    }

    if (!versionStdout.trim()) {
      console.warn(
        `[fetchRemoteDockerStatus] Docker version check on session ${state.ws.sessionId} produced no output, assuming Docker unavailable.`
      );
      return { available: false, containers: [] };
    }
  } catch (error: any) {
    console.error(
      `[fetchRemoteDockerStatus] Error executing docker version for session ${state.ws.sessionId}:`,
      error.message
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
      console.warn(
        `[fetchRemoteDockerStatus] Docker ps command failed unexpectedly after version check on session ${state.ws.sessionId}. Stderr: ${psStderr.trim()}`
      );
      return { available: false, containers: [] };
    }
    if (psStderr) {
      console.warn(
        `[fetchRemoteDockerStatus] Docker ps command stderr on session ${state.ws.sessionId}: ${psStderr.trim()}`
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
        } catch (parseError) {
          console.error(
            `[fetchRemoteDockerStatus] Failed to parse container JSON line for session ${state.ws.sessionId}: ${line}`,
            parseError
          );
          return null;
        }
      })
      .filter((container): container is DockerContainer => container !== null);
  } catch (error: any) {
    console.error(
      `[fetchRemoteDockerStatus] Error executing docker ps for session ${state.ws.sessionId}:`,
      error.message
    );
    return { available: false, containers: [] };
  }

  const runningContainerIds = allContainers.filter((c) => c.State === 'running').map((c) => c.id);

  if (runningContainerIds.length > 0) {
    try {
      // 净化所有 containerIds，仅允许安全字符（命令注入防护）
      const cleanContainerIds = runningContainerIds
        .map((id) => id.replace(/[^a-zA-Z0-9_-]/g, ''))
        .filter((id) => id.length > 0);

      if (cleanContainerIds.length === 0) {
        console.warn(
          `[fetchRemoteDockerStatus] All running container IDs failed sanitization for session ${state.ws.sessionId}.`
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
        console.warn(
          `[fetchRemoteDockerStatus] Docker stats command stderr on session ${state.ws.sessionId}: ${statsStderr.trim()}`
        );
      }

      const statsLines = statsStdout.trim() ? statsStdout.trim().split('\n') : [];
      statsLines.forEach((line) => {
        try {
          const statsData = JSON.parse(line) as DockerStats;
          if (statsData.ID) {
            statsMap.set(statsData.ID, statsData);
          }
        } catch (parseError) {
          console.error(
            `[fetchRemoteDockerStatus] Failed to parse stats JSON line for session ${state.ws.sessionId}: ${line}`,
            parseError
          );
        }
      });
    } catch (error: any) {
      console.warn(
        `[fetchRemoteDockerStatus] Error executing docker stats for session ${state.ws.sessionId}:`,
        error.message
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
  sessionId: string | undefined
): Promise<void> {
  const state = sessionId ? clientStates.get(sessionId) : undefined;
  if (!state) {
    console.warn(
      `WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 docker:get_status 请求，但无活动会话状态。`
    );
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'docker:status:error',
          payload: { message: 'Session state not found.' },
        })
      );
    return;
  }
  if (!state.sshClient) {
    console.warn(
      `WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 docker:get_status 请求，但无活动 SSH 连接。`
    );
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'docker:status:error',
          payload: { message: 'SSH connection not active.' },
        })
      );
    return;
  }
  try {
    const statusPayload = await fetchRemoteDockerStatus(state);
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'docker:status:update', payload: statusPayload }));
  } catch (error: any) {
    console.error(`WebSocket: 手动执行远程 Docker 状态命令失败 for session ${sessionId}:`, error);
    const errorMessage = error.message || 'Unknown error fetching status';
    const isUnavailable =
      errorMessage.includes('command not found') ||
      errorMessage.includes('Cannot connect to the Docker daemon');
    if (ws.readyState === WebSocket.OPEN) {
      if (isUnavailable) {
        ws.send(
          JSON.stringify({
            type: 'docker:status:update',
            payload: { available: false, containers: [] },
          })
        );
      } else {
        ws.send(
          JSON.stringify({
            type: 'docker:status:error',
            payload: { message: `Failed to get remote Docker status: ${errorMessage}` },
          })
        );
      }
    }
  }
}

export async function handleDockerCommand(
  ws: AuthenticatedWebSocket,
  sessionId: string | undefined,
  payload: any
): Promise<void> {
  const state = sessionId ? clientStates.get(sessionId) : undefined;
  if (!state || !state.sshClient) {
    console.warn(
      `WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 docker:command 请求，但无活动 SSH 连接。`
    );
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'docker:command:error',
          payload: { command: payload?.command, message: 'SSH connection not active.' },
        })
      );
    return;
  }
  const { containerId, command } = payload || {};
  if (
    !containerId ||
    typeof containerId !== 'string' ||
    !command ||
    !['start', 'stop', 'restart', 'remove'].includes(command)
  ) {
    console.error(
      `WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的无效 docker:command 请求。Payload:`,
      payload
    );
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'docker:command:error',
          payload: { command, message: 'Invalid containerId or command.' },
        })
      );
    return;
  }

  console.log(
    `WebSocket: Processing command '${command}' for container '${containerId}' on session ${sessionId}...`
  );
  try {
    const cleanContainerId = containerId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanContainerId) throw new Error('Invalid container ID format after sanitization.');

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
      default:
        throw new Error(`Unsupported command: ${command}`);
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
            console.log(
              `WebSocket: 远程 Docker 命令 (${dockerCliCommand}) on session ${sessionId} 执行成功。`
            );
            resolve();
          } else {
            console.error(
              `WebSocket: 远程 Docker 命令 (${dockerCliCommand}) on session ${sessionId} 执行失败 (Code: ${code}). Stderr: ${stderr}`
            );
            reject(new Error(`Command failed with code ${code}. ${stderr || 'No stderr output.'}`));
          }
        });
        stream.on('error', (execErr: Error) => reject(execErr));
      });
    });

    // Request a status update after a short delay
    setTimeout(() => {
      const currentState = clientStates.get(sessionId!); // Re-fetch state as it might have changed
      if (currentState && currentState.ws.readyState === WebSocket.OPEN) {
        currentState.ws.send(JSON.stringify({ type: 'request_docker_status_update' }));
      }
    }, 500);
  } catch (error: any) {
    console.error(
      `WebSocket: 执行远程 Docker 命令 (${command} for ${containerId}) 失败 for session ${sessionId}:`,
      error
    );
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'docker:command:error',
          payload: {
            command,
            containerId,
            message: `Failed to execute remote command: ${error.message}`,
          },
        })
      );
  }
}

export async function handleDockerGetStats(
  ws: AuthenticatedWebSocket,
  sessionId: string | undefined,
  payload: any
): Promise<void> {
  const state = sessionId ? clientStates.get(sessionId) : undefined;
  if (!state || !state.sshClient) {
    console.warn(
      `WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 docker:get_stats 请求，但无活动 SSH 连接。`
    );
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'docker:stats:error',
          payload: { containerId: payload?.containerId, message: 'SSH connection not active.' },
        })
      );
    return;
  }
  if (!payload || !payload.containerId) {
    console.warn(
      `WebSocket: Invalid payload for docker:get_stats in session ${sessionId}:`,
      payload
    );
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'docker:stats:error',
          payload: { containerId: payload?.containerId, message: 'Missing containerId.' },
        })
      );
    return;
  }

  const { containerId } = payload;

  // 净化 containerId，仅允许安全字符（命令注入防护）
  const cleanContainerId = containerId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleanContainerId) {
    console.error(
      `WebSocket: Invalid container ID format after sanitization for session ${sessionId}: ${containerId}`
    );
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'docker:stats:error',
          payload: { containerId, message: 'Invalid container ID format.' },
        })
      );
    return;
  }

  console.log(
    `WebSocket: Handling docker:get_stats for container ${cleanContainerId} in session ${sessionId}`
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
      console.error(
        `WebSocket: Docker stats stderr for ${containerId} in session ${sessionId}: ${execResult.stderr}`
      );
      if (ws.readyState === WebSocket.OPEN)
        ws.send(
          JSON.stringify({
            type: 'docker:stats:error',
            payload: {
              containerId,
              message: execResult.stderr.trim() || 'Error executing stats command.',
            },
          })
        );
      return;
    }

    if (!execResult.stdout) {
      console.warn(
        `WebSocket: No stats output for container ${containerId} in session ${sessionId}. Might be stopped or error occurred.`
      );
      if (!execResult.stderr && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'docker:stats:error',
            payload: {
              containerId,
              message: 'No stats data received (container might be stopped).',
            },
          })
        );
      }
      return;
    }

    try {
      const statsData = JSON.parse(execResult.stdout.trim());
      if (ws.readyState === WebSocket.OPEN)
        ws.send(
          JSON.stringify({
            type: 'docker:stats:update',
            payload: { containerId, stats: statsData },
          })
        );
    } catch (parseError) {
      console.error(
        `WebSocket: Failed to parse docker stats JSON for ${containerId} in session ${sessionId}: ${execResult.stdout}`,
        parseError
      );
      if (ws.readyState === WebSocket.OPEN)
        ws.send(
          JSON.stringify({
            type: 'docker:stats:error',
            payload: { containerId, message: 'Failed to parse stats data.' },
          })
        );
    }
  } catch (error: any) {
    console.error(
      `WebSocket: Failed to execute docker stats for ${containerId} in session ${sessionId}:`,
      error
    );
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: 'docker:stats:error',
          payload: { containerId, message: error.message || 'Failed to fetch Docker stats.' },
        })
      );
  }
}

export async function startDockerStatusPolling(sessionId: string): Promise<void> {
  const state = clientStates.get(sessionId);
  if (!state) {
    console.warn(`[Docker Polling] Cannot start polling for non-existent session ${sessionId}`);
    return;
  }

  console.log(`WebSocket: 会话 ${sessionId} 正在启动 Docker 状态轮询...`);
  let dockerPollIntervalMs = DEFAULT_DOCKER_STATUS_INTERVAL_SECONDS * 1000;
  try {
    const intervalSetting = await settingsService.getSetting('dockerStatusIntervalSeconds');
    if (intervalSetting) {
      const intervalSeconds = parseInt(intervalSetting, 10);
      if (!Number.isNaN(intervalSeconds) && intervalSeconds >= 1) {
        dockerPollIntervalMs = intervalSeconds * 1000;
        console.log(
          `[Docker Polling] Using interval from settings: ${intervalSeconds}s (${dockerPollIntervalMs}ms) for session ${sessionId}`
        );
      } else {
        console.warn(
          `[Docker Polling] Invalid interval setting '${intervalSetting}' found. Using default ${dockerPollIntervalMs}ms for session ${sessionId}`
        );
      }
    } else {
      console.log(
        `[Docker Polling] No interval setting found. Using default ${dockerPollIntervalMs}ms for session ${sessionId}`
      );
    }
  } catch (settingError) {
    console.error(
      `[Docker Polling] Error fetching interval setting for session ${sessionId}. Using default ${dockerPollIntervalMs}ms:`,
      settingError
    );
  }

  // Clear existing interval if any, to prevent multiple pollers for the same session
  if (state.dockerStatusIntervalId) {
    clearInterval(state.dockerStatusIntervalId);
    console.log(
      `[Docker Polling] Cleared existing Docker status interval for session ${sessionId}.`
    );
  }

  const dockerIntervalId = setInterval(async () => {
    const currentState = clientStates.get(sessionId); // Re-fetch state in case it changed (e.g., disconnected)
    if (!currentState || currentState.ws.readyState !== WebSocket.OPEN || !currentState.sshClient) {
      console.log(
        `[Docker Polling] Session ${sessionId} no longer valid, WS closed, or SSH disconnected. Stopping poll.`
      );
      clearInterval(dockerIntervalId);
      if (currentState && currentState.dockerStatusIntervalId === dockerIntervalId) {
        // Ensure we only delete our own interval ID
        delete currentState.dockerStatusIntervalId;
      }
      return;
    }
    try {
      const statusPayload = await fetchRemoteDockerStatus(currentState);
      if (currentState.ws.readyState === WebSocket.OPEN) {
        // Check again before sending
        currentState.ws.send(
          JSON.stringify({ type: 'docker:status:update', payload: statusPayload })
        );
      }
    } catch (error: any) {
      console.error(
        `[Docker Polling] Error fetching Docker status for session ${sessionId}:`,
        error.message
      );
      // Optionally send an error to the client if polling fails consistently,
      // but be mindful of flooding the client with errors.
      // if (currentState.ws.readyState === WebSocket.OPEN) {
      //     currentState.ws.send(JSON.stringify({ type: 'docker:status:error', payload: { message: `Polling error: ${error.message}` } }));
      // }
    }
  }, dockerPollIntervalMs);
  state.dockerStatusIntervalId = dockerIntervalId;

  // Initial fetch
  const initialState = clientStates.get(sessionId);
  if (initialState && initialState.ws.readyState === WebSocket.OPEN && initialState.sshClient) {
    console.log(`[Docker Initial Fetch] Fetching status for session ${sessionId}...`);
    try {
      const statusPayload = await fetchRemoteDockerStatus(initialState);
      if (initialState.ws.readyState === WebSocket.OPEN) {
        // Check again
        initialState.ws.send(
          JSON.stringify({ type: 'docker:status:update', payload: statusPayload })
        );
      }
    } catch (error: any) {
      console.error(
        `[Docker Initial Fetch] Error fetching Docker status for session ${sessionId}:`,
        error.message
      );
      if (initialState.ws.readyState === WebSocket.OPEN) {
        const errorMessage = error.message || 'Unknown error during initial fetch';
        const isUnavailable =
          errorMessage.includes('command not found') ||
          errorMessage.includes('Cannot connect to the Docker daemon');
        if (isUnavailable) {
          initialState.ws.send(
            JSON.stringify({
              type: 'docker:status:update',
              payload: { available: false, containers: [] },
            })
          );
        } else {
          initialState.ws.send(
            JSON.stringify({
              type: 'docker:status:error',
              payload: { message: `Initial Docker status fetch failed: ${errorMessage}` },
            })
          );
        }
      }
    }
  }
}
