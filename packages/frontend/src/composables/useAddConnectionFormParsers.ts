/**
 * 连接表单 - 解析器纯函数模块
 * 职责：IP 范围解析、脚本行解析（纯函数，无 Vue 响应式依赖）
 */

/** 连接类型 */
export type ConnectionType = 'SSH' | 'RDP' | 'VNC' | 'Telnet';

/** 认证方式 */
export type AuthMethod = 'password' | 'key';

/** 连接创建/更新请求载荷 */
export interface ConnectionPayload {
  type: ConnectionType;
  name: string;
  host: string;
  port: number;
  username: string;
  notes?: string;
  proxy_id?: number | null;
  proxy_type?: 'proxy' | 'jump' | null;
  tag_ids?: number[];
  jump_chain?: number[] | null;
  force_keyboard_interactive?: boolean;
  auth_method: AuthMethod;
  password?: string;
  ssh_key_id?: number | null;
}

import type { TranslateFn } from '../types/i18n.types';

/**
 * 解析 IP 范围字符串（如 "192.168.1.1~192.168.1.10"）
 * @returns IP 地址数组或包含错误信息的对象
 */
export function parseIpRange(ipRangeStr: string, t: TranslateFn): string[] | { error: string } {
  if (!ipRangeStr.includes('~')) {
    return { error: 'not_a_range' };
  }
  const parts = ipRangeStr.split('~');
  if (parts.length !== 2) {
    return {
      error: t('connections.form.errorInvalidIpRangeFormat', 'IP 范围格式应为 start_ip~end_ip'),
    };
  }

  const [startIpStr, endIpStr] = parts.map((p) => p.trim());

  const ipRegex = /^((\d{1,3}\.){3})\d{1,3}$/;
  if (!ipRegex.test(startIpStr) || !ipRegex.test(endIpStr)) {
    return { error: t('connections.form.errorInvalidIpFormat', '起始或结束 IP 地址格式无效') };
  }

  const startIpParts = startIpStr.split('.');
  const endIpParts = endIpStr.split('.');

  if (startIpParts.slice(0, 3).join('.') !== endIpParts.slice(0, 3).join('.')) {
    return {
      error: t(
        'connections.form.errorIpRangeNotSameSubnet',
        'IP 范围必须在同一个C段子网中 (例如 1.2.3.x ~ 1.2.3.y)',
      ),
    };
  }

  const startSuffix = parseInt(startIpParts[3], 10);
  const endSuffix = parseInt(endIpParts[3], 10);

  if (
    Number.isNaN(startSuffix) ||
    Number.isNaN(endSuffix) ||
    startSuffix < 0 ||
    startSuffix > 255 ||
    endSuffix < 0 ||
    endSuffix > 255
  ) {
    return {
      error: t('connections.form.errorInvalidIpSuffix', 'IP 地址最后一段必须是 0-255 之间的数字'),
    };
  }

  if (startSuffix > endSuffix) {
    return {
      error: t('connections.form.errorIpRangeStartAfterEnd', 'IP 范围的起始 IP 不能大于结束 IP'),
    };
  }

  const numIps = endSuffix - startSuffix + 1;
  if (numIps <= 0) {
    return { error: t('connections.form.errorIpRangeEmpty', 'IP 范围不能为空。') };
  }

  const baseIp = startIpParts.slice(0, 3).join('.');
  const ips: string[] = [];
  for (let i = startSuffix; i <= endSuffix; i++) {
    ips.push(`${baseIp}.${i}`);
  }
  return ips;
}

/**
 * 解析单行脚本命令（如 "user@host:22 -p password -k keyname"）
 * @returns 解析结果对象
 */
export function parseScriptLine(
  line: string,
  t: TranslateFn,
): {
  type: ConnectionType;
  userHostPort: string;
  name: string;
  password: string | null;
  keyName: string | null;
  proxyName: string | null;
  tags: string[];
  note: string | null;
  error?: string;
} {
  const trimmedLine = line.trim();
  if (!trimmedLine) {
    return {
      type: 'SSH',
      userHostPort: '',
      name: '',
      password: null,
      keyName: null,
      proxyName: null,
      tags: [],
      note: null,
      error: t('connections.form.scriptErrorEmptyLine', 'Input line cannot be empty'),
    };
  }

  // 1. 提取 user@host:port
  const firstSpaceIndex = trimmedLine.indexOf(' ');
  const userHostPortPart =
    firstSpaceIndex === -1 ? trimmedLine : trimmedLine.substring(0, firstSpaceIndex);
  const optionsString =
    firstSpaceIndex === -1 ? '' : trimmedLine.substring(firstSpaceIndex + 1).trim();

  // 2. 校验 user@host:port 格式（允许省略端口）
  const userHostPortRegex = /^([^@\s]+)@([^:\s]+)(?::([0-9]+))?$/;
  const match = userHostPortPart.match(userHostPortRegex);
  if (!match) {
    return {
      type: 'SSH',
      userHostPort: userHostPortPart,
      name: '',
      password: null,
      keyName: null,
      proxyName: null,
      tags: [],
      note: null,
      error: t('connections.form.scriptErrorInvalidUserHostPortFormat', {
        part: userHostPortPart,
      }),
    };
  }
  const [, user, host] = match;
  const defaultName = `${user}@${host}`;

  // 3. 初始化默认值
  let type: ConnectionType = 'SSH';
  let name: string = defaultName;
  let password: string | null = null;
  let keyName: string | null = null;
  let proxyName: string | null = null;
  let scriptTags: string[] = [];
  let note: string | null = null;

  // 4. 解析选项参数（按空格分割，尊重引号）
  const args = optionsString.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith('-')) {
      const key = arg.substring(1).toLowerCase();
      i++;

      if (key === 'tags') {
        // -tags 后可跟零或多个标签
        scriptTags = [];
        while (i < args.length && !args[i].startsWith('-')) {
          scriptTags.push(args[i].replace(/^"|"$/g, ''));
          i++;
        }
      } else if (key === 'note') {
        // -note 消耗行尾所有内容
        const noteParts = [];
        while (i < args.length) {
          noteParts.push(args[i]);
          i++;
        }
        note = noteParts.join(' ').replace(/^"|"$/g, '');
        break;
      } else if (i >= args.length) {
        // 其他选项需要值
        return {
          type,
          userHostPort: userHostPortPart,
          name,
          password,
          keyName,
          proxyName,
          tags: scriptTags,
          note,
          error: t('connections.form.scriptErrorMissingValueForKey', { key: arg }),
        };
      } else {
        const value = args[i].replace(/^"|"$/g, '');
        switch (key) {
          case 'type': {
            const typeValue = value.toUpperCase();
            if (typeValue === 'SSH' || typeValue === 'RDP' || typeValue === 'VNC') {
              type = typeValue;
            } else {
              return {
                type,
                userHostPort: userHostPortPart,
                name,
                password,
                keyName,
                proxyName,
                tags: scriptTags,
                note,
                error: t('connections.form.scriptErrorInvalidType', { value: args[i] }),
              };
            }
            break;
          }
          case 'name':
            name = value;
            break;
          case 'p':
          case 'password':
            password = value;
            break;
          case 'k':
          case 'key':
            keyName = value;
            break;
          case 'proxy':
            proxyName = value;
            break;
          default:
            // 未知选项忽略（兼容未来扩展）
            break;
        }
        i++;
      }
    } else {
      // 非选项参数忽略（兼容位置参数）
      i++;
    }
  }

  // 5. 按连接类型校验必填项
  if (type === 'SSH') {
    if (!password && !keyName) {
      return {
        type,
        userHostPort: userHostPortPart,
        name,
        password,
        keyName,
        proxyName,
        tags: scriptTags,
        note,
        error: t('connections.form.scriptErrorMissingAuthForSsh'),
      };
    }
  } else if (type === 'RDP') {
    if (!password) {
      return {
        type,
        userHostPort: userHostPortPart,
        name,
        password,
        keyName,
        proxyName,
        tags: scriptTags,
        note,
        error: t('connections.form.scriptErrorMissingPasswordForRdp'),
      };
    }
    if (keyName) {
      return {
        type,
        userHostPort: userHostPortPart,
        name,
        password,
        keyName,
        proxyName,
        tags: scriptTags,
        note,
        error: t('connections.form.scriptErrorKeyNotApplicableForRdp'),
      };
    }
  } else if (type === 'VNC') {
    if (!password) {
      return {
        type,
        userHostPort: userHostPortPart,
        name,
        password,
        keyName,
        proxyName,
        tags: scriptTags,
        note,
        error: t('connections.form.scriptErrorMissingPasswordForVnc'),
      };
    }
    if (keyName) {
      return {
        type,
        userHostPort: userHostPortPart,
        name,
        password,
        keyName,
        proxyName,
        tags: scriptTags,
        note,
        error: t('connections.form.scriptErrorKeyNotApplicableForVnc'),
      };
    }
  }

  return {
    type,
    userHostPort: userHostPortPart,
    name,
    password,
    keyName,
    proxyName,
    tags: scriptTags,
    note,
  };
}
