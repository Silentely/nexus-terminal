import { Router } from 'express';
import {
  login,
  verifyLogin2FA,
  changePassword,
  setup2FA,
  verifyAndActivate2FA,
  disable2FA,
  getAuthStatus,
  needsSetup,
  setupAdmin,
  logout,
  getPublicCaptchaConfig,
  // Passkey handlers
  generatePasskeyRegistrationOptionsHandler,
  verifyPasskeyRegistrationHandler,
  generatePasskeyAuthenticationOptionsHandler,
  verifyPasskeyAuthenticationHandler,
  // 新的 Passkey 管理处理器
  listUserPasskeysHandler,
  deleteUserPasskeyHandler,
  updateUserPasskeyNameHandler, // 更新 Passkey 名称的处理器
  checkHasPasskeys,
} from './auth.controller';
import { isAuthenticated } from './auth.middleware';
import { ipBlacklistCheckMiddleware } from './ipBlacklistCheck.middleware';
import { strictAuthLimiter, moderateAuthLimiter } from '../config/rate-limit.config';

const router = Router();

/**
 * @swagger
 * /api/v1/auth/captcha/config:
 *   get:
 *     summary: 获取公共 CAPTCHA 配置
 *     tags: [auth]
 *     security: []
 *     responses:
 *       200:
 *         description: 成功获取配置
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 captchaEnabled:
 *                   type: boolean
 *                 siteKey:
 *                   type: string
 *                   nullable: true
 */
router.get('/captcha/config', getPublicCaptchaConfig);

/**
 * @swagger
 * /api/v1/auth/needs-setup:
 *   get:
 *     summary: 检查是否需要初始设置
 *     description: 首次启动时检查系统是否需要创建管理员账户
 *     tags: [auth]
 *     security: []
 *     responses:
 *       200:
 *         description: 成功返回设置状态
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 needsSetup:
 *                   type: boolean
 *                   description: 是否需要初始设置
 */
router.get('/needs-setup', needsSetup);

/**
 * @swagger
 * /api/v1/auth/setup:
 *   post:
 *     summary: 执行初始管理员设置
 *     description: 首次启动时创建管理员账户（仅在 needsSetup 为 true 时可用）
 *     tags: [auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 description: 管理员用户名
 *                 example: admin
 *               password:
 *                 type: string
 *                 format: password
 *                 description: 管理员密码（建议使用强密码）
 *                 example: MySecurePassword123!
 *     responses:
 *       201:
 *         description: 管理员账户创建成功
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
 *                   example: 管理员账户创建成功
 *       422:
 *         description: 参数验证失败
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/setup', strictAuthLimiter, setupAdmin);

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: 用户登录
 *     description: 使用用户名和密码登录系统，成功后返回 Session Cookie
 *     tags: [auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 description: 用户名
 *                 example: admin
 *               password:
 *                 type: string
 *                 format: password
 *                 description: 密码
 *                 example: MySecurePassword123!
 *               captchaToken:
 *                 type: string
 *                 description: CAPTCHA 验证令牌（如果启用了 CAPTCHA）
 *     responses:
 *       200:
 *         description: 登录成功（如果未启用 2FA）
 *         headers:
 *           Set-Cookie:
 *             schema:
 *               type: string
 *               example: connect.sid=s%3A...; Path=/; HttpOnly
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
 *                   example: 登录成功
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     username:
 *                       type: string
 *       202:
 *         description: 需要进行 2FA 验证
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 require2FA:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: 请输入双因素验证码
 *       401:
 *         description: 用户名或密码错误
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/login', strictAuthLimiter, ipBlacklistCheckMiddleware, login);

/**
 * @swagger
 * /api/v1/auth/password:
 *   put:
 *     summary: 修改密码
 *     description: 修改当前登录用户的密码
 *     tags: [auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - oldPassword
 *               - newPassword
 *             properties:
 *               oldPassword:
 *                 type: string
 *                 format: password
 *                 description: 当前密码
 *               newPassword:
 *                 type: string
 *                 format: password
 *                 description: 新密码
 *     responses:
 *       200:
 *         description: 密码修改成功
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
 *                   example: 密码修改成功
 *       401:
 *         description: 当前密码错误或未登录
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put('/password', isAuthenticated, changePassword);

// POST /api/v1/auth/login/2fa - 登录时的 2FA 验证接口 (添加黑名单检查)
// (不需要单独的 isAuthenticated，依赖 login 接口设置的临时 session)
router.post('/login/2fa', strictAuthLimiter, ipBlacklistCheckMiddleware, verifyLogin2FA);

// --- 2FA 管理接口 (都需要认证) ---
// POST /api/v1/auth/2fa/setup - 开始 2FA 设置，生成密钥和二维码
router.post('/2fa/setup', isAuthenticated, setup2FA);

// POST /api/v1/auth/2fa/verify - 验证设置时的 TOTP 码并激活
router.post('/2fa/verify', isAuthenticated, verifyAndActivate2FA);

// DELETE /api/v1/auth/2fa - 禁用 2FA (需要验证当前密码，在控制器中处理)
router.delete('/2fa', isAuthenticated, disable2FA);

/**
 * @swagger
 * /api/v1/auth/status:
 *   get:
 *     summary: 获取当前认证状态
 *     description: 返回当前登录用户的信息和认证配置状态
 *     tags: [auth]
 *     responses:
 *       200:
 *         description: 成功获取认证状态
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 isAuthenticated:
 *                   type: boolean
 *                   example: true
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       example: 1
 *                     username:
 *                       type: string
 *                       example: admin
 *                     twoFactorEnabled:
 *                       type: boolean
 *                       example: false
 *                     hasPasskeys:
 *                       type: boolean
 *                       example: true
 *       401:
 *         description: 未登录
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/status', isAuthenticated, getAuthStatus);

// --- Passkey Routes ---
// POST /api/v1/auth/passkey/registration-options - 生成 Passkey 注册选项 (需要认证)
router.post(
  '/passkey/registration-options',
  isAuthenticated,
  generatePasskeyRegistrationOptionsHandler
);

// POST /api/v1/auth/passkey/register - 验证并保存新的 Passkey (需要认证，因为通常在已登录会话中添加新凭据)
router.post('/passkey/register', isAuthenticated, verifyPasskeyRegistrationHandler);

// POST /api/v1/auth/passkey/authentication-options - 生成 Passkey 认证选项 (公开或半公开，取决于是否提供了用户名)
router.post(
  '/passkey/authentication-options',
  moderateAuthLimiter,
  generatePasskeyAuthenticationOptionsHandler
);

// POST /api/v1/auth/passkey/authenticate - 验证 Passkey 并登录用户 (公开)
router.post(
  '/passkey/authenticate',
  strictAuthLimiter,
  ipBlacklistCheckMiddleware,
  verifyPasskeyAuthenticationHandler
);

// GET /api/v1/auth/passkey/has-configured - 检查是否配置了 Passkey (公开)
router.get('/passkey/has-configured', checkHasPasskeys);

// --- User's Passkey Management Routes (New) ---
// GET /api/v1/auth/user/passkeys - 获取当前用户的所有 Passkey (需要认证)
router.get('/user/passkeys', isAuthenticated, listUserPasskeysHandler);

// DELETE /api/v1/auth/user/passkeys/:credentialID - 删除当前用户指定的 Passkey (需要认证)
router.delete('/user/passkeys/:credentialID', isAuthenticated, deleteUserPasskeyHandler);

// PUT /api/v1/auth/user/passkeys/:credentialID/name - 更新当前用户指定的 Passkey 名称 (需要认证)
router.put('/user/passkeys/:credentialID/name', isAuthenticated, updateUserPasskeyNameHandler);

/**
 * @swagger
 * /api/v1/auth/logout:
 *   post:
 *     summary: 用户登出
 *     description: 销毁当前会话，清除登录状态
 *     tags: [auth]
 *     security: []
 *     responses:
 *       200:
 *         description: 登出成功
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
 *                   example: 登出成功
 */
router.post('/logout', logout);

export default router;
