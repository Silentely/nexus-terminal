import { Request, Response, NextFunction } from 'express';
import { DockerService, DockerCommand } from './docker.service';

// 由于没有 typedi，我们将手动实例化服务或通过其他方式获取实例
// 简单起见，这里直接 new 一个实例。在实际项目中，可能需要更复杂的实例管理。
const dockerService = new DockerService();

export class DockerController {
  /**
   * 处理获取 Docker 容器状态的请求 (GET /docker/status)
   */
  async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const status = await dockerService.getContainerStatus();
      res.json(status); // 直接返回 { available: boolean, containers: DockerContainer[] }
    } catch (error) {
      // 将错误传递给 Express 的错误处理中间件
      next(error);
    }
  }

  /**
   * 处理执行 Docker 命令的请求 (POST /docker/command)
   */
  async executeCommand(req: Request, res: Response, next: NextFunction): Promise<void> {
    // 从请求体中获取参数
    const { containerId, command } = req.body;

    // 基本的输入验证
    if (!containerId || typeof containerId !== 'string') {
      res.status(400).json({ message: 'Missing or invalid containerId in request body.' });
      return;
    }
    // 验证 command 是否是允许的类型
    const allowedCommands: DockerCommand[] = ['start', 'stop', 'restart', 'remove'];
    if (!command || !allowedCommands.includes(command)) {
      res
        .status(400)
        .json({ message: `Invalid command. Must be one of: ${allowedCommands.join(', ')}.` });
      return;
    }

    try {
      // 调用服务执行命令
      await dockerService.executeContainerCommand(containerId, command as DockerCommand);
      // 成功执行，返回 200 OK 或 204 No Content
      res.status(200).json({
        message: `Command '${command}' executed successfully for container ${containerId}.`,
      });
      // 或者 res.status(204).send();
    } catch (error: any) {
      // 根据错误类型返回不同的状态码
      if (error.message.includes('Docker is not available')) {
        res.status(503).json({ message: error.message }); // Service Unavailable
      } else if (
        error.message.includes('Invalid container ID') ||
        error.message.includes('Unsupported Docker command')
      ) {
        res.status(400).json({ message: error.message }); // Bad Request
      } else {
        // 其他执行错误，可能是 Docker 守护进程错误等
        res.status(500).json({ message: error.message || 'Failed to execute Docker command.' }); // Internal Server Error
      }
    }
  }
}
