import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// --- Interfaces (与前端 DockerManager.vue 中的定义保持一致) ---
// 理想情况下，这些类型应该放在共享的 types 包中
interface PortInfo {
  IP?: string;
  PrivatePort: number;
  PublicPort?: number;
  Type: 'tcp' | 'udp' | string;
}

// 与前端一致的 Stats 接口
interface DockerStats {
  ID: string; // Docker stats 返回的是 ID
  Name: string;
  CPUPerc: string;
  MemUsage: string;
  MemPerc: string;
  NetIO: string;
  BlockIO: string;
  PIDs: string;
}

interface DockerContainer {
  Id: string; // docker ps 返回的是 Id
  Names: string[];
  Image: string;
  ImageID: string;
  Command: string;
  Created: number;
  State: 'created' | 'restarting' | 'running' | 'removing' | 'paused' | 'exited' | 'dead' | string;
  Status: string;
  Ports: PortInfo[];
  Labels: Record<string, string>;
  stats?: DockerStats | null; // 添加可选的 stats 字段
  // 根据 `docker ps --format '{{json .}}'` 的输出添加其他需要的字段
}

// 定义命令类型
export type DockerCommand = 'start' | 'stop' | 'restart' | 'remove'; // 使用实际的 docker 命令

// @Service() // Removed typedi decorator
export class DockerService {
  private isDockerAvailableCache: boolean | null = null;
  private readonly commandTimeout = 15000; // 15 秒超时

  /**
   * 检查 Docker CLI 是否可用。包含缓存以避免重复检查。
   */
  async checkDockerAvailability(): Promise<boolean> {
    if (this.isDockerAvailableCache !== null) {
      return this.isDockerAvailableCache;
    }

    try {
      // 尝试执行一个简单的 docker 命令，如 docker version
      await execAsync('docker version', { timeout: 2000 }); // 5秒超时
      this.isDockerAvailableCache = true;
      return true;
    } catch (error: any) {
      this.isDockerAvailableCache = false;
      return false;
    }
  }

  /**
   * 获取所有 Docker 容器的状态 (包括已停止的)。
   */
  async getContainerStatus(): Promise<{ available: boolean; containers: DockerContainer[] }> {
    const available = await this.checkDockerAvailability();
    if (!available) {
      return { available: false, containers: [] };
    }

    let allContainers: DockerContainer[] = [];
    const statsMap = new Map<string, DockerStats>();

    // 1. 获取所有容器的基本信息
    try {
      const { stdout: psStdout } = await execAsync(
        "docker ps -a --no-trunc --format '{{json .}}'",
        { timeout: this.commandTimeout }
      );
      const lines = psStdout.trim().split('\n');
      allContainers = lines
        .map((line) => {
          try {
            const data = JSON.parse(line);
            if (typeof data.Names === 'string') {
              data.Names = data.Names.split(',');
            }
            if (!Array.isArray(data.Ports)) {
              data.Ports = [];
            }
            // 初始化 stats 为 null
            data.stats = null;
            return data as DockerContainer;
          } catch (parseError) {
            console.error(`[DockerService] Failed to parse container JSON line: ${line}`, {
              error: parseError,
            });
            return null;
          }
        })
        .filter((container): container is DockerContainer => container !== null);
    } catch (error: any) {
      console.error('[DockerService] Failed to execute "docker ps"', {
        error: error.message,
        stderr: error.stderr,
      });
      this.isDockerAvailableCache = false;
      return { available: false, containers: [] };
    }

    // 2. 获取正在运行容器的统计信息
    try {
      // --no-stream 获取一次性快照
      const { stdout: statsStdout } = await execAsync(
        "docker stats --no-stream --format '{{json .}}'",
        { timeout: this.commandTimeout }
      );
      const statsLines = statsStdout.trim().split('\n');
      statsLines.forEach((line) => {
        try {
          const statsData = JSON.parse(line) as DockerStats;
          // docker stats 返回的 ID 可能与 docker ps 的 Id 字段匹配
          // 注意：docker stats 可能返回短 ID，而 docker ps -a --no-trunc 返回长 ID
          // 实际应用中可能需要处理 ID 匹配问题，这里假设它们能直接匹配或通过 Name 匹配
          // 为了简化，我们优先使用 ID 匹配
          if (statsData.ID) {
            // 尝试直接用 ID 作为 key (可能是短 ID)
            // 如果 statsData.ID 是短 ID，而 allContainers 的 Id 是长 ID，这里可能匹配不上
            // 一个更健壮的方法是先从 allContainers 构建一个 Name -> ID 的映射
            // 但这里我们先简化处理，假设 ID 能匹配上
            statsMap.set(statsData.ID, statsData);
            // 也可以考虑用 Name 匹配作为备选
            // if (statsData.Name) statsMap.set(statsData.Name, statsData);
          }
        } catch (parseError) {
          console.error(`[DockerService] Failed to parse stats JSON line: ${line}`, {
            error: parseError,
          });
        }
      });
    } catch (error: any) {
      // 获取 stats 失败不应阻止返回容器列表，只是 stats 会是 null
      console.warn('[DockerService] Failed to execute "docker stats"', {
        error: error.message,
        stderr: error.stderr,
      });
    }

    // 3. 合并统计信息到容器列表
    allContainers.forEach((container) => {
      // 尝试用容器的长 ID 或短 ID (前12位) 或 Name 去匹配 statsMap
      const shortId = container.Id.substring(0, 12);
      const stats =
        statsMap.get(container.Id) || statsMap.get(shortId) || statsMap.get(container.Names[0]); // 尝试多种匹配方式
      if (stats) {
        container.stats = stats;
      }
    });

    return { available: true, containers: allContainers };
  }

  /**
   * 对指定的容器执行命令。
   * @param containerId 容器 ID
   * @param command 命令 ('start', 'stop', 'restart', 'remove')
   */
  async executeContainerCommand(containerId: string, command: DockerCommand): Promise<void> {
    const available = await this.checkDockerAvailability();
    if (!available) {
      throw new Error('Docker is not available.');
    }

    // 参数校验和清理，防止命令注入
    const cleanContainerId = containerId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanContainerId) {
      throw new Error('Invalid container ID format.');
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
        // 使用 -f 强制删除正在运行的容器，对应前端的 'down' 意图
        dockerCliCommand = `docker rm -f ${cleanContainerId}`;
        break;
      default:
        // 防止未知的命令类型
        console.error(`[DockerService] Received unknown command type: ${command}`); // Use console.error
        throw new Error(`Unsupported Docker command: ${command}`);
    }

    console.log(`[DockerService] Executing command: ${dockerCliCommand}`); // Use console.log
    try {
      const { stdout, stderr } = await execAsync(dockerCliCommand, {
        timeout: this.commandTimeout,
      });
      if (stderr) {
        // Docker 命令有时会将正常信息输出到 stderr (例如 rm 返回容器 ID)
        // 但也可能包含错误信息
        console.warn(`[DockerService] Command "${dockerCliCommand}" produced stderr:`, { stderr }); // Use console.warn
        // 可以根据 stderr 内容判断是否真的是错误
        if (stderr.toLowerCase().includes('error') || stderr.toLowerCase().includes('failed')) {
          throw new Error(`Docker command failed: ${stderr}`);
        }
      }
      console.log(`[DockerService] Command "${dockerCliCommand}" executed successfully.`, {
        stdout,
      }); // Use console.log
    } catch (error: any) {
      console.error(`[DockerService] Failed to execute command "${dockerCliCommand}"`, {
        error: error.message,
        stderr: error.stderr,
      }); // Use console.error
      // 抛出错误，让 Controller 层处理并返回给前端
      throw new Error(
        `Failed to execute Docker command "${command}": ${error.stderr || error.message}`
      );
    }
  }
}
