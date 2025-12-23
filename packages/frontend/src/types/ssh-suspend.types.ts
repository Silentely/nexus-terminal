/**
 * 表示从后端获取的单个挂起 SSH 会话的详细信息。
 */
export interface SuspendedSshSession {
  /** 挂起会话的唯一ID。 */
  suspendSessionId: string;
  /** 原始连接的名称，通常是主机名或用户定义的连接别名。 */
  connectionName: string;
  /** 原始连接的ID。 */
  connectionId: string;
  /** 会话挂起的开始时间，ISO 格式的日期字符串。 */
  suspendStartTime: string;
  /** 用户为该挂起会话自定义的名称。 */
  customSuspendName?: string;
  /**
   * 后端 SSH 连接的当前状态。
   * - 'hanging': SSH 连接仍在后端保持活跃。
   * - 'disconnected_by_backend': SSH 连接已从后端意外断开。
   */
  backendSshStatus: 'hanging' | 'disconnected_by_backend';
  /**
   * 如果连接已从后端断开 (backendSshStatus === 'disconnected_by_backend')，
   * 则此字段表示断开连接的时间戳，ISO 格式的日期字符串。
   */
  disconnectionTimestamp?: string;
}

/**
 * SSH_SUSPEND_LIST_RESPONSE 消息的载荷结构。
 */
export interface SshSuspendListResponsePayload {
  suspendSessions: SuspendedSshSession[];
}
