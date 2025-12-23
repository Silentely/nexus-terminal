import { z } from 'zod';

// --- SSH 基本操作 Schema ---

export const sshConnectSchema = z.object({
  type: z.literal('ssh:connect'),
  payload: z.object({
    connectionId: z.number().int().positive(),
  }),
});

export const sshInputSchema = z.object({
  type: z.literal('ssh:input'),
  payload: z.string().max(65536), // 限制终端输入不超过 64KB
});

export const sshResizeSchema = z.object({
  type: z.literal('ssh:resize'),
  payload: z.object({
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
});

// --- Docker 操作 Schema ---

export const dockerGetStatusSchema = z.object({
  type: z.literal('docker:get_status'),
});

export const dockerCommandSchema = z.object({
  type: z.literal('docker:command'),
  payload: z.object({
    containerId: z.string().min(1).max(100), // Docker ID 通常不超过 100 字符
    command: z.enum(['start', 'stop', 'restart', 'remove']),
  }),
});

export const dockerGetStatsSchema = z.object({
  type: z.literal('docker:get_stats'),
  payload: z.object({
    containerIds: z.array(z.string().min(1).max(100)).max(100), // 限制数组大小和字符串长度
  }),
});

// --- SFTP 基本操作 Schema ---

const sftpOperationTypes = z.enum([
  'sftp:readdir',
  'sftp:stat',
  'sftp:readfile',
  'sftp:writefile',
  'sftp:mkdir',
  'sftp:rmdir',
  'sftp:unlink',
  'sftp:rename',
  'sftp:chmod',
  'sftp:realpath',
  'sftp:copy',
  'sftp:move',
  'sftp:compress',
  'sftp:decompress',
]);

export const sftpBaseSchema = z.object({
  type: sftpOperationTypes,
  payload: z.any(), // SFTP 操作 payload 各异，保持宽松
  requestId: z.string().optional(),
});

// --- SFTP 上传操作 Schema ---

export const sftpUploadStartSchema = z.object({
  type: z.literal('sftp:upload:start'),
  payload: z.object({
    uploadId: z.string().min(1).max(100),
    fileName: z.string().min(1).max(1000), // 文件名限制
    fileSize: z.number().int().nonnegative().max(10737418240), // 最大 10GB
    targetPath: z.string().min(1).max(4096), // Linux PATH_MAX
  }),
});

export const sftpUploadChunkSchema = z.object({
  type: z.literal('sftp:upload:chunk'),
  payload: z.object({
    uploadId: z.string().min(1).max(100),
    chunk: z.string().min(1).max(2097152), // Base64 字符串，限制不超过 2MB
    chunkIndex: z.number().int().nonnegative(),
  }),
});

export const sftpUploadCancelSchema = z.object({
  type: z.literal('sftp:upload:cancel'),
  payload: z.object({
    uploadId: z.string().min(1),
  }),
});

// --- SSH Suspend 操作 Schema ---

export const sshSuspendListRequestSchema = z.object({
  type: z.literal('SSH_SUSPEND_LIST_REQUEST'),
});

export const sshSuspendResumeRequestSchema = z.object({
  type: z.literal('SSH_SUSPEND_RESUME_REQUEST'),
  payload: z.object({
    suspendSessionId: z.string().min(1).max(100),
    newFrontendSessionId: z.string().min(1).max(100),
  }),
});

export const sshSuspendTerminateRequestSchema = z.object({
  type: z.literal('SSH_SUSPEND_TERMINATE_REQUEST'),
  payload: z.object({
    suspendSessionId: z.string().min(1).max(100),
  }),
});

export const sshSuspendRemoveEntrySchema = z.object({
  type: z.literal('SSH_SUSPEND_REMOVE_ENTRY'),
  payload: z.object({
    suspendSessionId: z.string().min(1).max(100),
  }),
});

export const sshMarkForSuspendSchema = z.object({
  type: z.literal('SSH_MARK_FOR_SUSPEND'),
  payload: z.object({
    sessionId: z.string().min(1).max(100),
    initialBuffer: z.string().max(1048576).optional(), // 终端缓冲区限制 1MB
  }),
});

export const sshUnmarkForSuspendSchema = z.object({
  type: z.literal('SSH_UNMARK_FOR_SUSPEND'),
  payload: z.object({
    sessionId: z.string().min(1).max(100),
  }),
});

// --- 消息类型与 Schema 映射表 ---

export const messageSchemaRegistry = {
  // SSH 基本操作
  'ssh:connect': sshConnectSchema,
  'ssh:input': sshInputSchema,
  'ssh:resize': sshResizeSchema,

  // Docker 操作
  'docker:get_status': dockerGetStatusSchema,
  'docker:command': dockerCommandSchema,
  'docker:get_stats': dockerGetStatsSchema,

  // SFTP 基本操作
  'sftp:readdir': sftpBaseSchema,
  'sftp:stat': sftpBaseSchema,
  'sftp:readfile': sftpBaseSchema,
  'sftp:writefile': sftpBaseSchema,
  'sftp:mkdir': sftpBaseSchema,
  'sftp:rmdir': sftpBaseSchema,
  'sftp:unlink': sftpBaseSchema,
  'sftp:rename': sftpBaseSchema,
  'sftp:chmod': sftpBaseSchema,
  'sftp:realpath': sftpBaseSchema,
  'sftp:copy': sftpBaseSchema,
  'sftp:move': sftpBaseSchema,
  'sftp:compress': sftpBaseSchema,
  'sftp:decompress': sftpBaseSchema,

  // SFTP 上传操作
  'sftp:upload:start': sftpUploadStartSchema,
  'sftp:upload:chunk': sftpUploadChunkSchema,
  'sftp:upload:cancel': sftpUploadCancelSchema,

  // SSH Suspend 操作
  SSH_SUSPEND_LIST_REQUEST: sshSuspendListRequestSchema,
  SSH_SUSPEND_RESUME_REQUEST: sshSuspendResumeRequestSchema,
  SSH_SUSPEND_TERMINATE_REQUEST: sshSuspendTerminateRequestSchema,
  SSH_SUSPEND_REMOVE_ENTRY: sshSuspendRemoveEntrySchema,
  SSH_MARK_FOR_SUSPEND: sshMarkForSuspendSchema,
  SSH_UNMARK_FOR_SUSPEND: sshUnmarkForSuspendSchema,
} as const;

// 所有支持的消息类型
export type SupportedMessageType = keyof typeof messageSchemaRegistry;
