import axios from 'axios';
import { settingsService } from '../settings/settings.service';

// CAPTCHA 验证 API 端点
const HCAPTCHA_VERIFY_URL = 'https://api.hcaptcha.com/siteverify';
const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify'; // v2

export class CaptchaService {
  /**
   * 验证提供的 CAPTCHA 令牌。
   * 根据系统设置自动选择合适的提供商进行验证。
   * @param token - 从前端获取的 CAPTCHA 令牌 (h-captcha-response 或 g-recaptcha-response)
   * @returns Promise<boolean> - 令牌是否有效
   * @throws Error 如果配置无效或验证请求失败
   */
  async verifyToken(token: string): Promise<boolean> {
    if (!token) {
      console.warn('[CaptchaService] 验证失败：未提供令牌。');
      return false; // 没有令牌，直接视为无效
    }

    const captchaConfig = await settingsService.getCaptchaConfig();

    if (!captchaConfig.enabled) {
      console.log('[CaptchaService] CAPTCHA 未启用，跳过验证。');
      return true; // 未启用则视为验证通过
    }

    switch (captchaConfig.provider) {
      case 'hcaptcha':
        if (!captchaConfig.hcaptchaSecretKey) {
          throw new Error('hCaptcha 配置无效：缺少 Secret Key。');
        }
        return this._verifyHCaptcha(token, captchaConfig.hcaptchaSecretKey);
      case 'recaptcha':
        if (!captchaConfig.recaptchaSecretKey) {
          throw new Error('Google reCAPTCHA 配置无效：缺少 Secret Key。');
        }
        return this._verifyReCaptcha(token, captchaConfig.recaptchaSecretKey);
      case 'none':
        console.log('[CaptchaService] CAPTCHA 提供商设置为 "none"，跳过验证。');
        return true; // 提供商为 none 也视为通过
      default:
        console.error(`[CaptchaService] 未知的 CAPTCHA 提供商: ${captchaConfig.provider}`);
        throw new Error(`未知的 CAPTCHA 提供商配置: ${captchaConfig.provider}`);
    }
  }

  /**
   * 验证提供的 CAPTCHA 凭据 (Site Key 和 Secret Key)。
   * @param provider - CAPTCHA 提供商 ('hcaptcha' 或 'recaptcha')
   * @param siteKey - Site Key
   * @param secretKey - Secret Key
   * @returns Promise<boolean> - 凭据是否有效
   * @throws Error 如果提供商不受支持或验证请求失败
   */
  async verifyCredentials(
    provider: 'hcaptcha' | 'recaptcha',
    siteKey: string,
    secretKey: string
  ): Promise<boolean> {
    if (!siteKey || !secretKey) {
      console.warn(`[CaptchaService] 凭据验证失败：${provider} 的 Site Key 或 Secret Key 为空。`);
      return false;
    }

    // 使用一个固定的、已知的无效令牌或一个不太可能有效的测试令牌
    const testToken = 'static_test_token_for_credential_verification_NexusTerminal';

    console.log(
      `[CaptchaService] 正在验证 ${provider} 凭据 (SiteKey: ${siteKey.substring(0, 5)}...)`
    );

    try {
      let success = false;
      if (provider === 'hcaptcha') {
        success = await this._verifyHCaptcha(testToken, secretKey, siteKey, true);
      } else if (provider === 'recaptcha') {
        success = await this._verifyReCaptcha(testToken, secretKey, siteKey, true);
      } else {
        throw new Error(`不支持的 CAPTCHA 提供商: ${provider}`);
      }
      return success;
    } catch (error: any) {
      // _verifyHCaptcha/_verifyReCaptcha 在凭据检查模式下会抛出特定错误
      console.error(`[CaptchaService] ${provider} 凭据验证期间发生错误:`, error.message);
      return false; // 任何在验证方法内部捕获并重新抛出的错误都意味着凭据无效
    }
  }

  /**
   * 调用 hCaptcha API 验证令牌。
   * @param token - h-captcha-response 令牌
   * @param secretKey - hCaptcha Secret Key
   * @param siteKey - (可选) hCaptcha Site Key, 用于凭据验证模式
   * @param isCredentialVerification - (可选) 是否为凭据验证模式
   * @returns Promise<boolean> - 令牌/凭据是否有效
   */
  private async _verifyHCaptcha(
    token: string,
    secretKey: string,
    siteKey?: string,
    isCredentialVerification = false
  ): Promise<boolean> {
    const mode = isCredentialVerification ? '凭据' : '令牌';
    console.log(`[CaptchaService] 正在验证 hCaptcha ${mode}...`);
    try {
      const params = new URLSearchParams();
      params.append('secret', secretKey);
      params.append('response', token);
      if (siteKey) {
        // hCaptcha 的 siteverify 也接受 sitekey 参数
        params.append('sitekey', siteKey);
      }

      const response = await axios.post(HCAPTCHA_VERIFY_URL, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      console.log(`[CaptchaService] hCaptcha ${mode}验证响应:`, response.data);
      const errorCodes: string[] = response.data['error-codes'] || [];

      if (response.data && response.data.success === true) {
        console.log(`[CaptchaService] hCaptcha ${mode}验证成功。`);
        return true;
      }
      console.warn(
        `[CaptchaService] hCaptcha ${mode}验证失败:`,
        errorCodes.join(', ') || '未知错误'
      );
      if (isCredentialVerification) {
        // 对于凭据验证，如果错误不是关于密钥本身的，我们可能仍然认为密钥“可能”有效。
        // 关键的错误代码是 'invalid-input-secret'。'invalid-sitekey' 也是一个明确的凭据错误。
        // 其他错误，如 'missing-input-response', 'invalid-input-response' 是关于测试令牌的，可以忽略。
        if (errorCodes.includes('invalid-input-secret') || errorCodes.includes('invalid-sitekey')) {
          throw new Error(`hCaptcha 凭据无效: ${errorCodes.join(', ')}`);
        }
        // 如果没有明确的密钥错误，并且不是成功，对于凭据验证，这仍可能意味着密钥组合是“可查询的”
        // 但为了更严格，我们也可以返回 false，或根据具体错误代码决定。
        // 此处，如果不是特定的密钥错误，我们乐观地认为凭据本身“可能”没问题，只是测试令牌无效。
        // 然而，更安全的方式是，任何非 success 都视为凭据验证失败，除非 API 设计允许区分。
        // 为了符合“校验成功才能保存”，这里如果 success 为 false，即使没有特定密钥错误，也应该返回 false
        // 或者抛出错误让上层决定。我们在此处抛出，由 verifyCredentials 捕获并返回 false.
        if (
          errorCodes.length > 0 &&
          !errorCodes.includes('invalid-input-secret') &&
          !errorCodes.includes('invalid-sitekey')
        ) {
          // 例如： 'invalid-input-response', 'sitekey-secret-mismatch' (如果 sitekey 和 secret 不匹配但格式正确)
          // 'sitekey-secret-mismatch' 也是一个凭据问题
          if (errorCodes.includes('sitekey-secret-mismatch')) {
            throw new Error(`hCaptcha 凭据无效: sitekey 与 secret 不匹配`);
          }
          // 如果是 'invalid-input-response' 这类关于测试令牌的错误，我们认为密钥“可能”是对的。
          // 但前端期望布尔值，如果不是 success:true，这里就返回false，表示“未严格验证通过”
          console.warn(
            `[CaptchaService] hCaptcha ${mode}验证失败，但错误可能与测试令牌有关而非密钥本身: ${errorCodes.join(', ')}`
          );
          return false; // 对于凭据验证，如果不是true，就严格返回false
        }
        return false; // 其他所有情况的失败
      }
      return false; // 令牌验证失败
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message || '未知网络错误';
      console.error(
        `[CaptchaService] 调用 hCaptcha ${mode}验证 API 时出错:`,
        errorMessage,
        error.response?.data || ''
      );
      // 抛出错误，让上层处理
      throw new Error(`hCaptcha ${mode}验证请求失败: ${errorMessage}`);
    }
  }

  /**
   * 调用 Google reCAPTCHA API 验证令牌。
   * @param token - g-recaptcha-response 令牌
   * @param secretKey - Google reCAPTCHA Secret Key
   * @param siteKey - (可选) Google reCAPTCHA Site Key, reCAPTCHA 的 siteverify 不直接使用 sitekey 作为参数，但保留以保持接口一致性
   * @param isCredentialVerification - (可选) 是否为凭据验证模式
   * @returns Promise<boolean> - 令牌/凭据是否有效
   */
  private async _verifyReCaptcha(
    token: string,
    secretKey: string,
    siteKey?: string,
    isCredentialVerification = false
  ): Promise<boolean> {
    const mode = isCredentialVerification ? '凭据' : '令牌';
    console.log(
      `[CaptchaService] 正在验证 Google reCAPTCHA ${mode}... (SiteKey: ${siteKey ? `${siteKey.substring(0, 5)}...` : 'N/A'})`
    );
    try {
      const params = new URLSearchParams();
      params.append('secret', secretKey);
      params.append('response', token);
      // reCAPTCHA 的 siteverify API 不像 hCaptcha 那样直接接受 sitekey 参数
      // sitekey 的验证是隐式通过 secretKey 的。

      const response = await axios.post(RECAPTCHA_VERIFY_URL, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      console.log(`[CaptchaService] Google reCAPTCHA ${mode}验证响应:`, response.data);
      const errorCodes: string[] = response.data['error-codes'] || [];

      if (response.data && response.data.success === true) {
        console.log(`[CaptchaService] Google reCAPTCHA ${mode}验证成功。`);
        return true;
      }
      console.warn(
        `[CaptchaService] Google reCAPTCHA ${mode}验证失败:`,
        errorCodes.join(', ') || '未知错误'
      );
      if (isCredentialVerification) {
        // 对于凭据验证，关注与密钥相关的错误
        // 例如: 'invalid-input-secret', 'bad-request' (有时可能由错误的密钥导致), 'invalid-keys' (如果API支持)
        // 'missing-input-response', 'invalid-input-response' 是关于测试令牌的。
        if (
          errorCodes.includes('invalid-input-secret') ||
          errorCodes.includes('invalid-keys') /* hypothetical */
        ) {
          throw new Error(`Google reCAPTCHA 凭据无效: ${errorCodes.join(', ')}`);
        }
        // 如果是 'missing-input-response', 'invalid-input-response'
        // reCAPTCHA 倾向于对无效密钥返回 success: false 和 "invalid-input-secret"
        // 如果没有明确的密钥错误，并且不是 success，严格返回 false
        console.warn(
          `[CaptchaService] Google reCAPTCHA ${mode}验证失败，但错误可能与测试令牌有关而非密钥本身: ${errorCodes.join(', ')}`
        );
        return false; // 对于凭据验证，如果不是true，就严格返回false
      }
      return false; // 令牌验证失败
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message || '未知网络错误';
      console.error(
        `[CaptchaService] 调用 Google reCAPTCHA ${mode}验证 API 时出错:`,
        errorMessage,
        error.response?.data || ''
      );
      throw new Error(`Google reCAPTCHA ${mode}验证请求失败: ${errorMessage}`);
    }
  }
}

// 导出一个单例供其他服务使用
export const captchaService = new CaptchaService();
