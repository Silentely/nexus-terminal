import { Request, Response } from 'express';
import * as Service from './transfer-policy.service';
import { TransferContext } from './transfer-policy.types';

/**
 * 获取策略列表
 */
export const getPolicyList = async (req: Request, res: Response): Promise<void> => {
    try {
        const { scope, scope_id, enabled } = req.query;

        const query: any = {};
        if (scope) query.scope = scope;
        if (scope_id) query.scope_id = scope_id;
        if (enabled !== undefined) query.enabled = enabled === '1' ? 1 : 0;

        const policies = await Service.getPolicyList(query);
        res.status(200).json({ policies });
    } catch (error: any) {
        console.error('Controller: 获取策略列表失败:', error);
        res.status(500).json({ message: error.message || '获取策略列表失败' });
    }
};

/**
 * 获取单个策略
 */
export const getPolicyById = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const policy = await Service.getPolicyById(id);

        if (!policy) {
            res.status(404).json({ message: '策略不存在' });
            return;
        }

        res.status(200).json(policy);
    } catch (error: any) {
        console.error('Controller: 获取策略详情失败:', error);
        res.status(500).json({ message: error.message || '获取策略详情失败' });
    }
};

/**
 * 创建策略
 */
export const createPolicy = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            name,
            scope,
            scope_id,
            direction,
            max_file_size,
            max_total_size,
            allowed_extensions,
            blocked_extensions,
            enabled,
            priority
        } = req.body;

        if (!name || !scope) {
            res.status(400).json({ message: '缺少必要参数: name, scope' });
            return;
        }

        const result = await Service.createPolicy({
            name,
            scope,
            scope_id,
            direction,
            max_file_size,
            max_total_size,
            allowed_extensions,
            blocked_extensions,
            enabled,
            priority
        });

        res.status(201).json({
            message: '策略创建成功',
            ...result
        });
    } catch (error: any) {
        console.error('Controller: 创建策略失败:', error);

        if (error.message.includes('已存在') || error.message.includes('必须指定')) {
            res.status(400).json({ message: error.message });
        } else {
            res.status(500).json({ message: error.message || '创建策略失败' });
        }
    }
};

/**
 * 更新策略
 */
export const updatePolicy = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const {
            name,
            scope,
            scope_id,
            direction,
            max_file_size,
            max_total_size,
            allowed_extensions,
            blocked_extensions,
            enabled,
            priority
        } = req.body;

        if (!id) {
            res.status(400).json({ message: '缺少策略 ID' });
            return;
        }

        const result = await Service.updatePolicy({
            id,
            name,
            scope,
            scope_id,
            direction,
            max_file_size,
            max_total_size,
            allowed_extensions,
            blocked_extensions,
            enabled,
            priority
        });

        if (!result) {
            res.status(404).json({ message: '策略不存在或无需更新' });
            return;
        }

        res.status(200).json({ message: '策略更新成功' });
    } catch (error: any) {
        console.error('Controller: 更新策略失败:', error);

        if (error.message.includes('不存在') || error.message.includes('已存在') || error.message.includes('不能')) {
            res.status(400).json({ message: error.message });
        } else {
            res.status(500).json({ message: error.message || '更新策略失败' });
        }
    }
};

/**
 * 删除策略
 */
export const deletePolicy = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;

        if (!id) {
            res.status(400).json({ message: '缺少策略 ID' });
            return;
        }

        const result = await Service.deletePolicy(id);

        if (!result) {
            res.status(404).json({ message: '策略不存在或无法删除' });
            return;
        }

        res.status(200).json({ message: '策略删除成功' });
    } catch (error: any) {
        console.error('Controller: 删除策略失败:', error);

        if (error.message.includes('不存在') || error.message.includes('不能删除')) {
            res.status(400).json({ message: error.message });
        } else {
            res.status(500).json({ message: error.message || '删除策略失败' });
        }
    }
};

/**
 * 验证传输请求
 * 供 SFTP 服务在传输前调用
 */
export const validateTransfer = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req.session as any).userId;
        const { connection_id, direction, file_name, file_size } = req.body;

        if (!userId) {
            res.status(401).json({ message: '未登录' });
            return;
        }

        // 参数基础校验
        if (!direction || !file_name || file_size === undefined) {
            res.status(400).json({ message: '缺少必要参数: direction, file_name, file_size' });
            return;
        }

        // direction 枚举校验
        const validDirections = ['upload', 'download'];
        if (!validDirections.includes(direction)) {
            res.status(400).json({ message: `无效的传输方向: ${direction}` });
            return;
        }

        // file_size 解析和校验
        const parsedFileSize = parseInt(file_size, 10);
        if (isNaN(parsedFileSize) || parsedFileSize < 0) {
            res.status(400).json({ message: '无效的文件大小' });
            return;
        }

        // connection_id 解析和校验（如果提供）
        let parsedConnectionId: number | undefined;
        if (connection_id !== undefined && connection_id !== null && connection_id !== '') {
            parsedConnectionId = parseInt(connection_id, 10);
            if (isNaN(parsedConnectionId) || parsedConnectionId <= 0) {
                res.status(400).json({ message: '无效的连接 ID' });
                return;
            }
        }

        const context: TransferContext = {
            userId,
            connectionId: parsedConnectionId,
            direction,
            fileName: file_name,
            fileSize: parsedFileSize
        };

        const result = await Service.evaluateTransfer(context);

        if (!result.allowed) {
            res.status(403).json({
                allowed: false,
                reason: result.reason,
                policy_name: result.policy?.name
            });
            return;
        }

        res.status(200).json({ allowed: true });
    } catch (error: any) {
        console.error('Controller: 验证传输失败:', error);
        res.status(500).json({ message: error.message || '验证传输失败' });
    }
};

/**
 * 获取有效策略（用于前端显示当前适用的策略）
 */
export const getEffectivePolicies = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req.session as any).userId;
        const { connection_id } = req.query;

        if (!userId) {
            res.status(401).json({ message: '未登录' });
            return;
        }

        const policies = await Service.getEffectivePoliciesForDisplay(
            userId,
            connection_id ? parseInt(connection_id as string, 10) : undefined
        );

        res.status(200).json({ policies });
    } catch (error: any) {
        console.error('Controller: 获取有效策略失败:', error);
        res.status(500).json({ message: error.message || '获取有效策略失败' });
    }
};
