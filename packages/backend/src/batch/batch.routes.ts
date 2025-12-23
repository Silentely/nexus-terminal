/**
 * 批量作业路由定义
 */

import { Router } from 'express';
import * as BatchController from './batch.controller';
import { isAuthenticated } from '../auth/auth.middleware';

const router = Router();

// 所有路由都需要认证
router.use(isAuthenticated);

/**
 * @swagger
 * /api/v1/batch:
 *   post:
 *     summary: 执行批量命令
 *     description: 在多个服务器上并发执行相同的命令，支持自定义并发数、超时时间等参数
 *     tags: [batch]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - command
 *               - connectionIds
 *             properties:
 *               command:
 *                 type: string
 *                 description: 要执行的命令
 *                 example: "ls -la /home"
 *               connectionIds:
 *                 type: array
 *                 description: 目标连接 ID 数组
 *                 items:
 *                   type: integer
 *                 example: [1, 2, 3, 4, 5]
 *               concurrencyLimit:
 *                 type: integer
 *                 description: 并发执行数量限制（1-50）
 *                 minimum: 1
 *                 maximum: 50
 *                 default: 5
 *                 example: 10
 *               timeoutSeconds:
 *                 type: integer
 *                 description: 单个命令超时时间（秒，1-3600）
 *                 minimum: 1
 *                 maximum: 3600
 *                 default: 300
 *                 example: 60
 *               env:
 *                 type: object
 *                 description: 环境变量键值对
 *                 additionalProperties:
 *                   type: string
 *                 example:
 *                   NODE_ENV: "production"
 *                   DEBUG: "true"
 *               workdir:
 *                 type: string
 *                 description: 工作目录
 *                 example: "/opt/app"
 *               sudo:
 *                 type: boolean
 *                 description: 是否使用 sudo 执行
 *                 default: false
 *     responses:
 *       201:
 *         description: 批量任务创建成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 taskId:
 *                   type: string
 *                   description: 任务 ID（UUID）
 *                   example: "550e8400-e29b-41d4-a716-446655440000"
 *                 message:
 *                   type: string
 *                   example: "批量任务已创建，包含 5 个子任务"
 *                 task:
 *                   type: object
 *                   properties:
 *                     taskId:
 *                       type: string
 *                     command:
 *                       type: string
 *                     totalSubTasks:
 *                       type: integer
 *                     status:
 *                       type: string
 *                       enum: [pending, running, completed, cancelled]
 *       401:
 *         description: 未登录
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       422:
 *         description: 参数验证失败
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', BatchController.execBatch);

/**
 * @swagger
 * /api/v1/batch:
 *   get:
 *     summary: 获取任务列表
 *     description: 获取当前用户的批量任务列表（支持分页）
 *     tags: [batch]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: 每页数量
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: 偏移量
 *     responses:
 *       200:
 *         description: 成功获取任务列表
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 tasks:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       taskId:
 *                         type: string
 *                       command:
 *                         type: string
 *                       status:
 *                         type: string
 *                         enum: [pending, running, completed, cancelled]
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                 limit:
 *                   type: integer
 *                 offset:
 *                   type: integer
 */
router.get('/', BatchController.getTaskList);

/**
 * @swagger
 * /api/v1/batch/{taskId}:
 *   get:
 *     summary: 获取任务状态
 *     description: 获取指定批量任务的详细状态和子任务信息
 *     tags: [batch]
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *         description: 任务 ID
 *     responses:
 *       200:
 *         description: 成功获取任务状态
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 task:
 *                   type: object
 *                   properties:
 *                     taskId:
 *                       type: string
 *                     command:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [pending, running, completed, cancelled]
 *                     totalSubTasks:
 *                       type: integer
 *                     completedSubTasks:
 *                       type: integer
 *                     failedSubTasks:
 *                       type: integer
 *                     subTasks:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           subTaskId:
 *                             type: string
 *                           connectionId:
 *                             type: integer
 *                           status:
 *                             type: string
 *                           stdout:
 *                             type: string
 *                           stderr:
 *                             type: string
 *                           exitCode:
 *                             type: integer
 *                             nullable: true
 *       403:
 *         description: 无权访问此任务
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: 任务不存在
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:taskId', BatchController.getTaskStatus);

/**
 * @swagger
 * /api/v1/batch/{taskId}/cancel:
 *   post:
 *     summary: 取消任务
 *     description: 取消正在执行的批量任务
 *     tags: [batch]
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *         description: 任务 ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: 取消原因（可选）
 *                 example: "用户手动取消"
 *     responses:
 *       200:
 *         description: 任务已取消
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 taskId:
 *                   type: string
 *                 message:
 *                   type: string
 *                   example: "任务已取消"
 *       400:
 *         description: 无法取消任务（可能已完成或已取消）
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/:taskId/cancel', BatchController.cancelTask);

/**
 * @swagger
 * /api/v1/batch/{taskId}:
 *   delete:
 *     summary: 删除任务
 *     description: 删除指定的批量任务记录（包括所有子任务）
 *     tags: [batch]
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *         description: 任务 ID
 *     responses:
 *       200:
 *         description: 任务已删除
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "任务已删除"
 *       404:
 *         description: 任务不存在或无权删除
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete('/:taskId', BatchController.deleteTask);

export default router;
