import { z } from 'zod';

// 源文件/目录项 schema
export const sourceItemSchema = z.object({
  name: z.string().min(1, '文件名不能为空'),
  path: z.string().min(1, '文件路径不能为空'),
  type: z.enum(['file', 'directory']),
});

// 发起传输请求的 payload schema
export const initiateTransferPayloadSchema = z.object({
  sourceConnectionId: z.number().int().positive('sourceConnectionId 必须是正整数'),
  connectionIds: z
    .array(z.number().int().positive('connectionIds 中的元素必须是正整数'))
    .min(1, 'connectionIds 不能为空数组'),
  sourceItems: z.array(sourceItemSchema).min(1, 'sourceItems 不能为空数组'),
  remoteTargetPath: z.string().min(1, 'remoteTargetPath 不能为空'),
  transferMethod: z.enum(['auto', 'rsync', 'scp']),
});

export type InitiateTransferPayloadValidated = z.infer<typeof initiateTransferPayloadSchema>;
