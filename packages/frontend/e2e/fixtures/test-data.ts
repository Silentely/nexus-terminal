/**
 * E2E 测试数据定义
 */

/**
 * SSH 连接测试数据
 */
export const SSH_CONNECTION = {
  name: 'E2E Test SSH Server',
  host: process.env.E2E_SSH_HOST || 'localhost',
  port: parseInt(process.env.E2E_SSH_PORT || '22', 10),
  username: process.env.E2E_SSH_USERNAME || 'testuser',
  password: process.env.E2E_SSH_PASSWORD || 'testpass',
  authMethod: 'password' as const,
};

/**
 * SFTP 测试数据
 */
export const SFTP_TEST_DATA = {
  testFilename: 'e2e-test-file.txt',
  testContent: `E2E Test Content - ${new Date().toISOString()}`,
  testDirectory: '/tmp/nexus-e2e-test',
};

/**
 * RDP 连接测试数据
 */
export const RDP_CONNECTION = {
  name: 'E2E Test RDP Server',
  host: process.env.E2E_RDP_HOST || 'localhost',
  port: parseInt(process.env.E2E_RDP_PORT || '3389', 10),
  username: process.env.E2E_RDP_USERNAME || 'Administrator',
  password: process.env.E2E_RDP_PASSWORD || 'password',
};

/**
 * VNC 连接测试数据
 */
export const VNC_CONNECTION = {
  name: 'E2E Test VNC Server',
  host: process.env.E2E_VNC_HOST || 'localhost',
  port: parseInt(process.env.E2E_VNC_PORT || '5900', 10),
  password: process.env.E2E_VNC_PASSWORD || 'password',
};

/**
 * 2FA 测试数据
 */
export const TWO_FACTOR_AUTH = {
  secret: process.env.E2E_2FA_SECRET || 'JBSWY3DPEHPK3PXP',
};
