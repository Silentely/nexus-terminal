import { Request, Response } from 'express';
import * as ProxyService from './proxy.service';
import { AuditLogService } from '../audit/audit.service';

const auditLogService = new AuditLogService();

const sanitizeProxy = (
  proxy: ProxyService.ProxyData | null
): Partial<ProxyService.ProxyData> | null => {
  if (!proxy) return null;
  const { encrypted_password, encrypted_private_key, encrypted_passphrase, ...sanitized } = proxy;
  return sanitized;
};

// 获取所有代理配置 (不含敏感信息)
export const getAllProxies = async (req: Request, res: Response) => {
  try {
    const proxies = await ProxyService.getAllProxies();
    res.status(200).json(proxies.map(sanitizeProxy));
  } catch (error: any) {
    console.error('Controller: 获取代理列表失败:', error);
    res.status(500).json({ message: '获取代理列表失败', error: error.message });
  }
};

// 获取单个代理配置 (不含敏感信息)
export const getProxyById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const proxyId = parseInt(id, 10);
    if (isNaN(proxyId)) {
      return res.status(400).json({ message: '无效的代理 ID' });
    }
    const proxy = await ProxyService.getProxyById(proxyId);

    if (proxy) {
      res.status(200).json(sanitizeProxy(proxy));
    } else {
      res.status(404).json({ message: `未找到 ID 为 ${id} 的代理` });
    }
  } catch (error: any) {
    console.error(`Controller: 获取代理 ${id} 失败:`, error);
    res.status(500).json({ message: `获取代理 ${id} 失败`, error: error.message });
  }
};

// 创建新的代理配置
export const createProxy = async (req: Request, res: Response) => {
  try {
    const { name, type, host, port } = req.body;
    if (!name || !type || !host || !port) {
      return res.status(400).json({ message: '缺少必要的代理信息 (name, type, host, port)' });
    }
    if (type !== 'SOCKS5' && type !== 'HTTP') {
      return res.status(400).json({ message: '无效的代理类型，仅支持 SOCKS5 或 HTTP' });
    }

    const newProxy = await ProxyService.createProxy(req.body);
    // 记录审计日志
    auditLogService.logAction('PROXY_CREATED', {
      proxyId: newProxy.id,
      name: newProxy.name,
      type: newProxy.type,
    });
    res.status(201).json({
      message: '代理创建成功',
      proxy: sanitizeProxy(newProxy),
    });
  } catch (error: any) {
    console.error('Controller: 创建代理失败:', error);
    if (
      error.message.includes('UNIQUE constraint failed') ||
      error.message.includes('同名字段冲突')
    ) {
      return res
        .status(409)
        .json({ message: '创建代理失败：可能存在同名字段冲突', error: error.message });
    }
    if (error.message.includes('缺少') || error.message.includes('需要提供')) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: '创建代理失败', error: error.message });
  }
};

// 更新代理配置
export const updateProxy = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const proxyId = parseInt(id, 10);
    if (isNaN(proxyId)) {
      return res.status(400).json({ message: '无效的代理 ID' });
    }

    const { name, type, host, port, username, password, auth_method, private_key, passphrase } =
      req.body;
    if (
      !name &&
      !type &&
      !host &&
      port === undefined &&
      username === undefined &&
      password === undefined &&
      auth_method === undefined &&
      private_key === undefined &&
      passphrase === undefined
    ) {
      return res.status(400).json({ message: '没有提供任何要更新的字段' });
    }
    if (type && type !== 'SOCKS5' && type !== 'HTTP') {
      return res.status(400).json({ message: '无效的代理类型，仅支持 SOCKS5 或 HTTP' });
    }

    const updatedProxy = await ProxyService.updateProxy(proxyId, req.body);

    if (updatedProxy) {
      auditLogService.logAction('PROXY_UPDATED', { proxyId, updatedFields: Object.keys(req.body) });
      res.status(200).json({ message: '代理更新成功', proxy: sanitizeProxy(updatedProxy) });
    } else {
      res.status(404).json({ message: `未找到 ID 为 ${id} 的代理进行更新` });
    }
  } catch (error: any) {
    console.error(`Controller: 更新代理 ${id} 失败:`, error);
    if (
      error.message.includes('UNIQUE constraint failed') ||
      error.message.includes('同名字段冲突')
    ) {
      return res
        .status(409)
        .json({ message: '更新代理失败：可能存在同名字段冲突', error: error.message });
    }
    if (error.message.includes('需要提供')) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: `更新代理 ${id} 失败`, error: error.message });
  }
};

// 删除代理配置
export const deleteProxy = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const proxyId = parseInt(id, 10);
    if (isNaN(proxyId)) {
      return res.status(400).json({ message: '无效的代理 ID' });
    }

    const deleted = await ProxyService.deleteProxy(proxyId);

    if (deleted) {
      // 记录审计日志
      auditLogService.logAction('PROXY_DELETED', { proxyId });
      res.status(200).json({ message: `代理 ${id} 删除成功` });
    } else {
      res.status(404).json({ message: `未找到 ID 为 ${id} 的代理进行删除` });
    }
  } catch (error: any) {
    console.error(`Controller: 删除代理 ${id} 失败:`, error);
    res.status(500).json({ message: `删除代理 ${id} 失败`, error: error.message });
  }
};
