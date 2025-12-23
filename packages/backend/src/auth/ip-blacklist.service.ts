import { getDbInstance, runDb, getDb as getDbRow, allDb } from '../database/connection';
import { settingsService } from '../settings/settings.service';
import { NotificationService } from '../notifications/notification.service';

const notificationService = new NotificationService(); // 实例化 NotificationService

// 黑名单相关设置的 Key
const MAX_LOGIN_ATTEMPTS_KEY = 'maxLoginAttempts';
const LOGIN_BAN_DURATION_KEY = 'loginBanDuration'; // 单位：秒

// 与 ipWhitelist.middleware.ts 保持一致
const LOCAL_IPS = [
  '127.0.0.1', // IPv4 本地回环
  '::1', // IPv6 本地回环
  'localhost', // 本地主机名 (虽然通常解析为上面两者，但也包含以防万一)
];

// 黑名单条目接口
interface IpBlacklistEntry {
  ip: string;
  attempts: number;
  last_attempt_at: number;
  blocked_until: number | null;
}

type DbIpBlacklistRow = IpBlacklistEntry;

export class IpBlacklistService {
  /**
   * 获取指定 IP 的黑名单记录
   * @param ip IP 地址
   * @returns 黑名单记录或 undefined
   */
  private async getEntry(ip: string): Promise<IpBlacklistEntry | undefined> {
    try {
      const db = await getDbInstance();
      const row = await getDbRow<DbIpBlacklistRow>(db, 'SELECT * FROM ip_blacklist WHERE ip = ?', [
        ip,
      ]);
      return row; // Returns undefined if not found
    } catch (err: any) {
      console.error(`[IP Blacklist] 查询 IP ${ip} 时出错:`, err.message);
      throw new Error('数据库查询失败'); // Re-throw error
    }
  }

  /**
   * 检查 IP 是否当前被封禁
   * @param ip IP 地址
   * @returns 如果被封禁则返回 true，否则返回 false
   */
  async isBlocked(ip: string): Promise<boolean> {
    // 首先检查功能是否启用
    if (!(await settingsService.isIpBlacklistEnabled())) {
      // console.log('[IP Blacklist] 功能已禁用，跳过 isBlocked 检查。');
      return false; // 如果禁用，则认为 IP 未被阻止
    }

    try {
      const entry = await this.getEntry(ip);
      if (!entry) {
        return false; // 不在黑名单中
      }
      // 检查封禁时间是否已过
      if (entry.blocked_until && entry.blocked_until > Math.floor(Date.now() / 1000)) {
        console.log(
          `[IP Blacklist] IP ${ip} 当前被封禁，直到 ${new Date(entry.blocked_until * 1000).toISOString()}`
        );
        return true; // 仍在封禁期内
      }
      return false;
    } catch (error: any) {
      // Catch errors from getEntry
      console.error(`[IP Blacklist] 检查 IP ${ip} 封禁状态时出错:`, error.message);
      return false; // 出错时默认不封禁
    }
  }

  /**
   * 记录一次登录失败尝试
   * 如果达到阈值，则封禁该 IP
   * @param ip IP 地址
   */
  async recordFailedAttempt(ip: string): Promise<void> {
    // 首先检查功能是否启用
    if (!(await settingsService.isIpBlacklistEnabled())) {
      // console.log('[IP Blacklist] 功能已禁用，跳过 recordFailedAttempt。');
      return; // 如果禁用，则不记录失败尝试
    }

    if (LOCAL_IPS.includes(ip)) {
      console.log(`[IP Blacklist] 检测到本地 IP ${ip} 登录失败，跳过黑名单处理。`);
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    try {
      const db = await getDbInstance();
      const maxAttemptsStr = await settingsService.getSetting(MAX_LOGIN_ATTEMPTS_KEY);
      const banDurationStr = await settingsService.getSetting(LOGIN_BAN_DURATION_KEY);

      const maxAttempts = parseInt(maxAttemptsStr || '5', 10) || 5;
      const banDuration = parseInt(banDurationStr || '300', 10) || 300;

      const entry = await this.getEntry(ip);

      if (entry) {
        const newAttempts = entry.attempts + 1;
        let blockedUntil = entry.blocked_until;
        let shouldNotify = false;

        if (newAttempts >= maxAttempts && !entry.blocked_until) {
          blockedUntil = now + banDuration;
          shouldNotify = true;
          console.warn(
            `[IP Blacklist] IP ${ip} 登录失败次数达到 ${newAttempts} 次 (阈值 ${maxAttempts})，将被封禁 ${banDuration} 秒。`
          );
        } else if (newAttempts >= maxAttempts && entry.blocked_until) {
          console.log(`[IP Blacklist] IP ${ip} 再次登录失败，当前已处于封禁状态。`);
        }

        await runDb(
          db,
          'UPDATE ip_blacklist SET attempts = ?, last_attempt_at = ?, blocked_until = ? WHERE ip = ?',
          [newAttempts, now, blockedUntil, ip]
        );

        if (shouldNotify && blockedUntil) {
          notificationService
            .sendNotification('IP_BLOCKED', {
              ip,
              attempts: newAttempts,
              duration: banDuration,
              blockedUntil: new Date(blockedUntil * 1000).toISOString(),
            })
            .catch((err) =>
              console.error(`[IP Blacklist] 发送 IP_BLACKLISTED 通知失败 for IP ${ip}:`, err)
            );
        }
      } else {
        // Insert new record
        let blockedUntil: number | null = null;
        const attempts = 1;
        let shouldNotify = false;

        if (attempts >= maxAttempts) {
          blockedUntil = now + banDuration;
          shouldNotify = true;
          console.warn(
            `[IP Blacklist] IP ${ip} 首次登录失败即达到阈值 ${maxAttempts}，将被封禁 ${banDuration} 秒。`
          );
        }

        await runDb(
          db,
          'INSERT INTO ip_blacklist (ip, attempts, last_attempt_at, blocked_until) VALUES (?, ?, ?, ?)',
          [ip, attempts, now, blockedUntil]
        );

        if (shouldNotify && blockedUntil) {
          notificationService
            .sendNotification('IP_BLOCKED', {
              ip,
              attempts,
              duration: banDuration,
              blockedUntil: new Date(blockedUntil * 1000).toISOString(),
            })
            .catch((err) =>
              console.error(`[IP Blacklist] 发送 IP_BLACKLISTED 通知失败 for IP ${ip}:`, err)
            );
        }
      }
    } catch (error: any) {
      console.error(`[IP Blacklist] 记录 IP ${ip} 失败尝试时出错:`, error.message);
    }
  }

  /**
   * 重置指定 IP 的失败尝试次数和封禁状态 (例如登录成功后调用)
   * @param ip IP 地址
   */
  async resetAttempts(ip: string): Promise<void> {
    try {
      const db = await getDbInstance();
      await runDb(db, 'DELETE FROM ip_blacklist WHERE ip = ?', [ip]);
      console.log(`[IP Blacklist] 已重置 IP ${ip} 的失败尝试记录。`);
    } catch (error: any) {
      console.error(`[IP Blacklist] 重置 IP ${ip} 尝试次数时出错:`, error.message);
    }
  }

  /**
   * 获取所有黑名单记录 (用于管理界面)
   * @param limit 每页数量
   * @param offset 偏移量
   */
  async getBlacklist(
    limit: number = 50,
    offset: number = 0
  ): Promise<{ entries: IpBlacklistEntry[]; total: number }> {
    try {
      const db = await getDbInstance();
      const entries = await allDb<DbIpBlacklistRow>(
        db,
        'SELECT * FROM ip_blacklist ORDER BY last_attempt_at DESC LIMIT ? OFFSET ?',
        [limit, offset]
      );
      const countRow = await getDbRow<{ count: number }>(
        db,
        'SELECT COUNT(*) as count FROM ip_blacklist'
      );
      const total = countRow?.count ?? 0;
      return { entries, total };
    } catch (error: any) {
      console.error('[IP Blacklist] 获取黑名单列表时出错:', error.message);
      return { entries: [], total: 0 };
    }
  }

  /**
   * 从黑名单中删除一个 IP (解除封禁)
   * @param ip IP 地址
   * @returns Promise<boolean> 是否成功删除
   */
  async removeFromBlacklist(ip: string): Promise<boolean> {
    try {
      const db = await getDbInstance();
      const result = await runDb(db, 'DELETE FROM ip_blacklist WHERE ip = ?', [ip]);
      if (result.changes > 0) {
        console.log(`[IP Blacklist] 已从黑名单中删除 IP ${ip}。`);
        return true;
      }
      console.warn(`[IP Blacklist] 尝试删除 IP ${ip}，但该 IP 不在黑名单中。`);
      return false;
    } catch (error: any) {
      console.error(`[IP Blacklist] 从黑名单删除 IP ${ip} 时出错:`, error.message);
      throw new Error(`从黑名单删除 IP ${ip} 时出错`);
    }
  }
}

// 导出单例
export const ipBlacklistService = new IpBlacklistService();
