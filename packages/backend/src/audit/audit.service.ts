import { AuditLogRepository } from './audit.repository';
import { AuditLogActionType, AuditLogEntry } from '../types/audit.types';

export class AuditLogService {
  private repository: AuditLogRepository;

  constructor() {
    this.repository = new AuditLogRepository();
  }

  /**
   * 记录一条审计日志
   * @param actionType 操作类型
   * @param details 可选的详细信息 (对象或字符串)
   */
  async logAction(
    actionType: AuditLogActionType,
    details?: Record<string, any> | string | null
  ): Promise<void> {
    // 在这里可以添加额外的逻辑，例如：
    // - 检查是否需要记录此类型的日志 (基于配置)
    // - 格式化 details
    // - 异步执行，不阻塞主流程
    try {
      // 使用 'await' 确保日志记录完成（如果需要保证顺序或处理错误）
      // 或者不使用 'await' 让其在后台执行
      await this.repository.addLog(actionType, details);
    } catch (error) {
      // Repository 内部已经处理了错误打印，这里可以根据需要再次处理或忽略
      console.error(`[Audit Service] Failed to log action ${actionType}:`, error);
    }
  }

  /**
   * 获取审计日志列表
   * @param limit 每页数量
   * @param offset 偏移量
   * @param actionType 可选的操作类型过滤
   * @param startDate 可选的开始时间戳 (秒)
   * @param endDate 可选的结束时间戳 (秒)
   */
  async getLogs(
    limit: number = 50,
    offset: number = 0,
    actionType?: AuditLogActionType,
    startDate?: number,
    endDate?: number,
    searchTerm?: string // 添加 searchTerm 参数
  ): Promise<{ logs: AuditLogEntry[]; total: number }> {
    // 将 searchTerm 传递给 repository
    return this.repository.getLogs(limit, offset, actionType, startDate, endDate, searchTerm);
  }

  /**
   * 删除所有审计日志
   * @returns 删除的记录数
   */
  async deleteAllLogs(): Promise<number> {
    return this.repository.deleteAllLogs();
  }

  /**
   * 获取审计日志总数
   * @returns 日志总数
   */
  async getLogCount(): Promise<number> {
    return this.repository.getLogCount();
  }
}
