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

export const sshExecSilentSchema = z
  .object({
    type: z.literal('ssh:exec_silent'),
    requestId: z.string().min(1).max(128).optional(),
    payload: z.object({
      command: z.string().min(1).max(4096).optional(),
      commandsByShell: z.record(z.string().max(64), z.string().max(4096)).optional(),
      timeoutMs: z.number().int().min(1000).max(20000).optional(),
      shellFlavorHint: z.enum(['posix', 'powershell', 'cmd', 'fish']).optional(),
      successCriteria: z.enum(['any', 'non_empty', 'absolute_path']).optional(),
      suppressTerminalPrompt: z.boolean().optional(),
    }),
  })
  .superRefine((message, ctx) => {
    const { command, commandsByShell } = message.payload;
    if (!command && (!commandsByShell || Object.keys(commandsByShell).length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payload'],
        message: 'payload.command 或 payload.commandsByShell 至少提供一个',
      });
    }
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

// --- Telnet 基本操作 Schema ---

export const telnetConnectSchema = z.object({
  type: z.literal('telnet:connect'),
  payload: z.object({
    connectionId: z.number().int().positive(),
  }),
});

export const telnetInputSchema = z.object({
  type: z.literal('telnet:input'),
  payload: z.object({
    sessionId: z.string().min(1).max(128),
    data: z.string().max(65536), // base64 编码的输入数据
  }),
});

export const telnetResizeSchema = z.object({
  type: z.literal('telnet:resize'),
  payload: z.object({
    sessionId: z.string().min(1).max(128),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
});

export const telnetDisconnectSchema = z.object({
  type: z.literal('telnet:disconnect'),
  payload: z.object({
    sessionId: z.string().min(1).max(128),
  }),
});

// --- SFTP 基本操作 Schema ---

// 为每个 SFTP 操作定义专用 payload schema，替换原来的 z.any()
// 所有 schema 必须使用 .strict() 防止 z.union 中的误匹配
// （Zod 默认 strip 模式会静默丢弃未知字段，导致联合类型匹配到错误的 schema）
const sftpPathPayloadSchema = z
  .object({
    path: z.string().min(1).max(4096),
  })
  .strict();

const sftpReadfilePayloadSchema = z
  .object({
    path: z.string().min(1).max(4096),
    encoding: z.string().max(64).optional(),
  })
  .strict();

const sftpWritefilePayloadSchema = z
  .object({
    path: z.string().min(1).max(4096),
    content: z.string().max(10485760).optional(), // 最大 10MB
    data: z.string().max(10485760).optional(),
    encoding: z.string().max(64).optional(),
  })
  .strict()
  .refine((obj) => obj.content !== undefined || obj.data !== undefined, {
    message: 'writefile payload 必须包含 content 或 data 字段',
  });

const sftpRenamePayloadSchema = z
  .object({
    oldPath: z.string().min(1).max(4096),
    newPath: z.string().min(1).max(4096),
  })
  .strict();

const sftpChmodPayloadSchema = z
  .object({
    path: z.string().min(1).max(4096),
    mode: z.number().int().min(0).max(0o7777),
  })
  .strict();

const sftpCopyMovePayloadSchema = z
  .object({
    sources: z.array(z.string().min(1).max(4096)).min(1).max(100),
    destination: z.string().min(1).max(4096),
  })
  .strict();

const sftpCompressPayloadSchema = z
  .object({
    sources: z.array(z.string().min(1).max(4096)).min(1).max(100),
    destination: z.string().min(1).max(4096),
    format: z.enum(['zip', 'targz', 'tarbz2']),
  })
  .strict();

const sftpDecompressPayloadSchema = z
  .object({
    source: z.string().min(1).max(4096),
    destination: z.string().max(4096).optional(), // 前端可能发送，后端当前未使用
  })
  .strict();

/** SFTP 基本操作 payload 联合类型，按操作类型区分验证 */
const sftpBasePayloadSchema = z.union([
  sftpPathPayloadSchema, // readdir, stat, mkdir, rmdir, unlink, realpath
  sftpReadfilePayloadSchema,
  sftpWritefilePayloadSchema,
  sftpRenamePayloadSchema,
  sftpChmodPayloadSchema,
  sftpCopyMovePayloadSchema,
  sftpCompressPayloadSchema,
  sftpDecompressPayloadSchema,
]);

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
  payload: sftpBasePayloadSchema,
  requestId: z.string().optional(),
});

// --- SFTP 上传操作 Schema ---

const sftpUploadIdSchema = z.string().min(1).max(100);
const sftpUploadSizeSchema = z.number().int().nonnegative().max(10737418240); // 最大 10GB
const sftpUploadPathSchema = z.string().min(1).max(4096); // Linux PATH_MAX
const sftpUploadChunkDataSchema = z.string().max(2097152); // Base64 数据，限制不超过 2MB（允许空字符串用于零字节文件）

const sftpUploadStartPayloadSchema = z
  .union([
    z.object({
      // 当前前端协议
      uploadId: sftpUploadIdSchema,
      remotePath: sftpUploadPathSchema,
      size: sftpUploadSizeSchema,
      relativePath: z.string().max(4096).optional(),
    }),
    z.object({
      // 兼容旧协议（历史字段）
      uploadId: sftpUploadIdSchema,
      fileName: z.string().min(1).max(1000),
      fileSize: sftpUploadSizeSchema,
      targetPath: sftpUploadPathSchema,
    }),
  ])
  .transform((payload) => {
    if ('remotePath' in payload) {
      return payload;
    }

    return {
      uploadId: payload.uploadId,
      remotePath: payload.targetPath,
      size: payload.fileSize,
      relativePath: undefined as string | undefined,
    };
  });

export const sftpUploadStartSchema = z.object({
  type: z.literal('sftp:upload:start'),
  payload: sftpUploadStartPayloadSchema,
});

const sftpUploadChunkPayloadSchema = z
  .union([
    z.object({
      // 当前前端协议
      uploadId: sftpUploadIdSchema,
      data: sftpUploadChunkDataSchema,
      chunkIndex: z.number().int().nonnegative(),
      isLast: z.boolean().optional(),
    }),
    z.object({
      // 兼容旧协议（历史字段）
      uploadId: sftpUploadIdSchema,
      chunk: sftpUploadChunkDataSchema,
      chunkIndex: z.number().int().nonnegative(),
      isLast: z.boolean().optional(),
    }),
  ])
  .transform((payload) => {
    if ('data' in payload) {
      return payload;
    }

    return {
      uploadId: payload.uploadId,
      data: payload.chunk,
      chunkIndex: payload.chunkIndex,
      isLast: payload.isLast,
    };
  });

export const sftpUploadChunkSchema = z.object({
  type: z.literal('sftp:upload:chunk'),
  payload: sftpUploadChunkPayloadSchema,
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

// 多路复用：前端关闭通道时通知后端清理会话资源
export const sessionCloseSchema = z.object({
  type: z.literal('session:close'),
  // 前端发送空对象；允许缺省以兼容精简客户端
  payload: z.object({}).passthrough().optional(),
});

// --- 消息类型与 Schema 映射表 ---

export const messageSchemaRegistry = {
  // SSH 基本操作
  'ssh:connect': sshConnectSchema,
  'ssh:input': sshInputSchema,
  'ssh:resize': sshResizeSchema,
  'ssh:exec_silent': sshExecSilentSchema,

  // Telnet 基本操作
  'telnet:connect': telnetConnectSchema,
  'telnet:input': telnetInputSchema,
  'telnet:resize': telnetResizeSchema,
  'telnet:disconnect': telnetDisconnectSchema,

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

  // 多路复用通道关闭
  'session:close': sessionCloseSchema,

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
