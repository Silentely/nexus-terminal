/**
 * 跨主机传输共用工具
 * 纯函数：SSH 配置构建、shell 转义、传输命令拼装
 */
import type { Client, ConnectConfig } from 'ssh2';
import type { ConnectionWithTags, DecryptedConnectionCredentials } from '../types/connection.types';
import { shellEscape } from '../utils/shell-escape';

/** 与全局 shellEscape 同义，保留 transfers 域内命名 */
export const escapeShellArg = shellEscape;

/** 带底层 socket 状态的 SSH 客户端 */
export type SshClientWithSocketState = Client & {
  _sock?: {
    destroyed?: boolean;
  };
};

/**
 * 判断 SSH 客户端底层 socket 是否仍可用
 */
export function hasOpenClientSocket(client: Client): client is SshClientWithSocketState {
  const clientWithSocket = client as SshClientWithSocketState;
  return Boolean(clientWithSocket._sock && !clientWithSocket._sock.destroyed);
}

/**
 * 根据连接信息与解密凭据构建 ssh2 ConnectConfig
 */
export function buildSshConnectConfig(
  connectionInfo: ConnectionWithTags,
  credentials: DecryptedConnectionCredentials,
): ConnectConfig {
  const config: ConnectConfig = {
    host: connectionInfo.host,
    port: connectionInfo.port || 22,
    username: connectionInfo.username,
    readyTimeout: 20000,
    keepaliveInterval: 10000,
  };
  if (connectionInfo.auth_method === 'password' && credentials.decryptedPassword) {
    config.password = credentials.decryptedPassword;
  } else if (connectionInfo.auth_method === 'key' && credentials.decryptedPrivateKey) {
    config.privateKey = credentials.decryptedPrivateKey;
    if (credentials.decryptedPassphrase) {
      config.passphrase = credentials.decryptedPassphrase;
    }
  }
  return config;
}

/** 构建 rsync/scp 远程传输命令时的选项 */
export interface TransferCommandOptions {
  sshPassCommand?: string;
  sshIdentityFileOption?: string;
  targetUserAndHost: string;
  sshPortOption?: string;
}

/**
 * 在源机上执行的 rsync/scp 命令字符串
 */
export function buildTransferCommandString(
  sourceItemPathOnA: string,
  isDir: boolean,
  targetPathOnB: string,
  executableCommand: string,
  commandType: 'rsync' | 'scp',
  options: TransferCommandOptions,
): string {
  const remoteBase = targetPathOnB.endsWith('/') ? targetPathOnB : `${targetPathOnB}/`;
  const remoteFullDest = `${options.targetUserAndHost}:${escapeShellArg(remoteBase)}`;

  const commandParts: string[] = [];
  if (options.sshPassCommand) {
    commandParts.push(options.sshPassCommand);
  }

  commandParts.push(executableCommand);

  if (commandType === 'rsync') {
    commandParts.push('-avz --progress');
    let sshArgsForRsync = `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
    if (options.sshPortOption && options.sshPortOption.startsWith('-p')) {
      sshArgsForRsync += ` ${options.sshPortOption}`;
    }
    if (options.sshIdentityFileOption) {
      sshArgsForRsync += ` ${options.sshIdentityFileOption}`;
    }
    commandParts.push(`-e "${sshArgsForRsync.trim()}"`);

    let rsyncSourcePath = escapeShellArg(sourceItemPathOnA);
    if (isDir && !rsyncSourcePath.endsWith("/'")) {
      rsyncSourcePath = `${rsyncSourcePath.slice(0, -1)}/'`;
    }
    commandParts.push(rsyncSourcePath);
    commandParts.push(remoteFullDest);
  } else {
    commandParts.push('-o StrictHostKeyChecking=no');
    commandParts.push('-o UserKnownHostsFile=/dev/null');
    if (isDir) commandParts.push('-r');
    if (options.sshPortOption && options.sshPortOption.startsWith('-P')) {
      commandParts.push(options.sshPortOption);
    }
    if (options.sshIdentityFileOption) {
      commandParts.push(options.sshIdentityFileOption);
    }
    commandParts.push(escapeShellArg(sourceItemPathOnA));
    commandParts.push(remoteFullDest);
  }
  return commandParts.join(' ');
}
