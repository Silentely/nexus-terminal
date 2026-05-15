import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from '../utils/apiClient';
import { setLocale } from '../i18n';
import { extractErrorMessage } from '../utils/errorExtractor';
import { navigateToLoginAfterLogout } from '../utils/authRuntimeBridge';
import { log } from '@/utils/log';

interface UserInfo {
  id: number;
  username: string;
  isTwoFactorEnabled?: boolean;
  language?: 'en' | 'zh';
}

export interface PasskeyInfo {
  credentialID: string;
  publicKey: string;
  counter: number;
  transports?: AuthenticatorTransport[];
  creationDate: string;
  lastUsedDate: string;
  name?: string;
}

interface LoginPayload {
  username: string;
  password: string;
  rememberMe?: boolean;
}

interface PublicCaptchaConfig {
  enabled: boolean;
  provider: 'hcaptcha' | 'recaptcha' | 'none';
  hcaptchaSiteKey?: string;
  recaptchaSiteKey?: string;
}

interface FullCaptchaSettings {
  enabled: boolean;
  provider: 'hcaptcha' | 'recaptcha' | 'none';
  hcaptchaSiteKey?: string;
  hcaptchaSecretKey?: string;
  recaptchaSiteKey?: string;
  recaptchaSecretKey?: string;
}

export interface IpBlacklistEntry {
  ip: string;
  attempts: number;
  last_attempt_at: number;
  blocked_until: number | null;
}

export const useAuthStore = defineStore(
  'auth',
  () => {
    // --- State ---
    const isAuthenticated = ref(false);
    const user = ref<UserInfo | null>(null);
    const isLoading = ref(false);
    const error = ref<string | null>(null);
    const loginRequires2FA = ref(false);
    const tempToken = ref<string | null>(null);
    const ipBlacklist = ref<{ entries: IpBlacklistEntry[]; total: number }>({
      entries: [],
      total: 0,
    });
    const needsSetup = ref(false);
    const publicCaptchaConfig = ref<PublicCaptchaConfig | null>(null);
    const passkeys = ref<PasskeyInfo[] | null>(null);
    const passkeysLoading = ref(false);
    const hasPasskeysAvailable = ref(false);
    const isInitCompleted = ref(false);

    // --- Getters ---
    const loggedInUser = computed(() => user.value?.username);

    /**
     * Clears the current error message.
     */
    function clearError() {
      error.value = null;
    }

    /**
     * Set the store's current error message.
     *
     * @param errorMessage - The message to store; replaces any existing error
     */
    function setError(errorMessage: string) {
      error.value = errorMessage;
    }

    /**
     * Attempt to authenticate a user with credentials and an optional CAPTCHA token.
     *
     * @param payload - Login credentials and optional `captchaToken` for CAPTCHA verification
     * @returns `{ requiresTwoFactor: true }` if the server requires two-factor authentication; `{ success: true }` on successful login; `{ success: false, error: string }` on failure
     */
    async function login(payload: LoginPayload & { captchaToken?: string }) {
      isLoading.value = true;
      error.value = null;
      loginRequires2FA.value = false;
      try {
        const response = await apiClient.post<{
          message: string;
          user?: UserInfo;
          requiresTwoFactor?: boolean;
          tempToken?: string;
        }>('/auth/login', payload);

        if (response.data.requiresTwoFactor) {
          log.info('登录需要 2FA 验证');
          loginRequires2FA.value = true;
          tempToken.value = response.data.tempToken || null;
          return { requiresTwoFactor: true };
        }
        if (response.data.user) {
          isAuthenticated.value = true;
          user.value = response.data.user;
          log.info('登录成功 (无 2FA):', user.value);
          if (user.value?.language) {
            setLocale(user.value.language);
          }
          window.location.href = '/';
          return { success: true };
        }
        throw new Error('登录响应无效');
      } catch (err: unknown) {
        log.error('登录失败:', err);
        isAuthenticated.value = false;
        user.value = null;
        loginRequires2FA.value = false;
        tempToken.value = null;
        error.value = extractErrorMessage(err, '');
        return { success: false, error: error.value };
      } finally {
        isLoading.value = false;
      }
    }

    /**
     * Complete a pending two-factor authentication (2FA) login using the provided 2FA token.
     *
     * @param token - The one-time 2FA token provided by the user
     * @returns `{ success: true }` when authentication completes and the user is redirected; otherwise `{ success: false, error: string }` containing the extracted error message
     * @throws When the current login flow is not awaiting 2FA verification
     */
    async function verifyLogin2FA(token: string) {
      if (!loginRequires2FA.value) {
        throw new Error('当前登录流程不需要 2FA 验证。');
      }
      isLoading.value = true;
      error.value = null;
      try {
        const response = await apiClient.post<{ message: string; user: UserInfo }>(
          '/auth/login/2fa',
          { token, tempToken: tempToken.value }
        );
        isAuthenticated.value = true;
        user.value = response.data.user;
        loginRequires2FA.value = false;
        tempToken.value = null;
        log.info('2FA 验证成功，登录完成:', user.value);
        if (user.value?.language) {
          setLocale(user.value.language);
        }
        window.location.href = '/';
        return { success: true };
      } catch (err: unknown) {
        log.error('2FA 验证失败:', err);
        error.value = extractErrorMessage(err, '');
        return { success: false, error: error.value };
      } finally {
        isLoading.value = false;
      }
    }

    /**
     * Log out the current user and navigate to the login page.
     *
     * Attempts to end the session on the server; on success clears local authentication state and redirects to the login flow. On failure sets the store's error state.
     */
    async function logout() {
      isLoading.value = true;
      error.value = null;
      loginRequires2FA.value = false;
      try {
        await apiClient.post('/auth/logout');
        isAuthenticated.value = false;
        user.value = null;
        log.info('已登出');
        await navigateToLoginAfterLogout();
      } catch (err: unknown) {
        log.error('登出失败:', err);
        error.value = extractErrorMessage(err, '');
      } finally {
        isLoading.value = false;
      }
    }

    /**
     * Refreshes authentication state from the server and updates the store accordingly.
     *
     * On success updates `isAuthenticated`, `user`, and clears `loginRequires2FA`; if the retrieved user has a `language` it applies it via `setLocale`. On failure resets authentication-related state (`isAuthenticated=false`, `user=null`, `loginRequires2FA=false`) and logs a warning. Sets `isLoading` while the operation is in progress.
     */
    async function checkAuthStatus() {
      isLoading.value = true;
      try {
        const response = await apiClient.get<{ isAuthenticated: boolean; user: UserInfo }>(
          '/auth/status'
        );
        if (response.data.isAuthenticated && response.data.user) {
          isAuthenticated.value = true;
          user.value = response.data.user;
          loginRequires2FA.value = false;
          log.info('认证状态已更新:', user.value);
          if (user.value?.language) {
            setLocale(user.value.language);
          }
        } else {
          isAuthenticated.value = false;
          user.value = null;
          loginRequires2FA.value = false;
        }
      } catch (err: unknown) {
        log.warn('检查认证状态失败:', extractErrorMessage(err, '检查认证状态失败'));
        isAuthenticated.value = false;
        user.value = null;
        loginRequires2FA.value = false;
      } finally {
        isLoading.value = false;
      }
    }

    /**
     * Change the authenticated user's password.
     *
     * @param currentPassword - The user's current password.
     * @param newPassword - The new password to set.
     * @returns `true` if the password was changed successfully.
     * @throws Will throw an Error if the user is not authenticated or if the change fails.
     */
    async function changePassword(currentPassword: string, newPassword: string) {
      if (!isAuthenticated.value) {
        throw new Error('用户未登录，无法修改密码。');
      }
      isLoading.value = true;
      error.value = null;
      try {
        const response = await apiClient.put<{ message: string }>('/auth/password', {
          currentPassword,
          newPassword,
        });
        log.info('密码修改成功:', response.data.message);
        return true;
      } catch (err: unknown) {
        log.error('修改密码失败:', err);
        error.value = extractErrorMessage(err, '');
        throw new Error(error.value ?? '修改密码时发生未知错误。');
      } finally {
        isLoading.value = false;
      }
    }

    /**
     * Fetches a page of IP blacklist entries from the backend and stores them in the store.
     *
     * @param limit - Maximum number of entries to return (defaults to 50)
     * @param offset - Number of entries to skip for pagination (defaults to 0)
     * @returns The response data containing `entries` and `total`
     * @throws An Error with a user-facing message when the request fails
     */
    async function fetchIpBlacklist(limit: number = 50, offset: number = 0) {
      isLoading.value = true;
      error.value = null;
      try {
        const response = await apiClient.get('/settings/ip-blacklist', {
          params: { limit, offset },
        });
        ipBlacklist.value.entries = response.data.entries;
        ipBlacklist.value.total = response.data.total;
        log.info('获取 IP 黑名单成功:', response.data);
        return response.data;
      } catch (err: unknown) {
        log.error('获取 IP 黑名单失败:', err);
        error.value = extractErrorMessage(err, '');
        throw new Error(error.value ?? '获取 IP 黑名单时发生未知错误。');
      } finally {
        isLoading.value = false;
      }
    }

    /**
     * Remove an IP address from the server-side blacklist and update the local blacklist state.
     *
     * @param ip - The IP address to remove from the blacklist
     * @returns `true` on successful deletion
     * @throws An `Error` with a user-facing message when the deletion request fails
     */
    async function deleteIpFromBlacklist(ip: string) {
      isLoading.value = true;
      error.value = null;
      try {
        await apiClient.delete(`/settings/ip-blacklist/${encodeURIComponent(ip)}`);
        log.info(`IP ${ip} 已从黑名单删除`);
        ipBlacklist.value.entries = ipBlacklist.value.entries.filter((entry) => entry.ip !== ip);
        ipBlacklist.value.total = Math.max(0, ipBlacklist.value.total - 1);
        return true;
      } catch (err: unknown) {
        log.error(`删除 IP ${ip} 失败:`, err);
        error.value = extractErrorMessage(err, '');
        throw new Error(error.value ?? '删除 IP 时发生未知错误。');
      } finally {
        isLoading.value = false;
      }
    }

    /**
     * Fetches the server's "needs setup" flag, updates the store's `needsSetup` state, and returns the result.
     *
     * On failure, sets `needsSetup` to `false` and returns `false`.
     *
     * @returns `true` if the server reports that initial setup is required, `false` otherwise.
     */
    async function checkSetupStatus() {
      try {
        const response = await apiClient.get<{ needsSetup: boolean }>('/auth/needs-setup');
        needsSetup.value = response.data.needsSetup;
        log.info(`[AuthStore] Needs setup status: ${needsSetup.value}`);
        return needsSetup.value;
      } catch (err: unknown) {
        log.error('检查设置状态失败:', extractErrorMessage(err, '检查设置状态失败'));
        needsSetup.value = false;
        return false;
      }
    }

    /**
     * Fetches CAPTCHA configuration from the server and updates the store's `publicCaptchaConfig` used by the public UI.
     *
     * On success, sets `publicCaptchaConfig` with `provider`, `enabled`, and any site keys returned by the backend.
     * On failure, sets `publicCaptchaConfig` to `{ enabled: false, provider: 'none' }`.
     */
    async function fetchCaptchaConfig() {
      log.info('[AuthStore] fetchCaptchaConfig called. Forcing refetch.');
      try {
        log.info('[AuthStore] Fetching CAPTCHA config from /settings/captcha...');
        const response = await apiClient.get<FullCaptchaSettings>('/settings/captcha');
        const fullConfig = response.data;
        publicCaptchaConfig.value = {
          enabled: fullConfig.enabled,
          provider: fullConfig.provider,
          hcaptchaSiteKey: fullConfig.hcaptchaSiteKey,
          recaptchaSiteKey: fullConfig.recaptchaSiteKey,
        };
        log.info(
          '[AuthStore] Public CAPTCHA config derived from /settings/captcha:',
          publicCaptchaConfig.value
        );
      } catch (err: unknown) {
        log.error(
          '获取 CAPTCHA 配置失败 (from /settings/captcha):',
          extractErrorMessage(err, '获取 CAPTCHA 配置失败')
        );
        publicCaptchaConfig.value = {
          enabled: false,
          provider: 'none',
        };
      }
    }

    /**
     * Authenticate a user using a passkey (WebAuthn) and establish the session on success.
     *
     * On success, sets authentication state and the current user, applies the user's locale if present,
     * and navigates to the application root (`/`). On failure, clears authenticated user state and
     * returns the error message.
     *
     * @param username - The username to authenticate
     * @param assertionResponse - The WebAuthn assertion response returned by the authenticator (shape depends on the WebAuthn API)
     * @returns An object with `success: true` when authentication succeeds; on failure, `success: false` and `error` contains the error message
     */
    async function loginWithPasskey(username: string, assertionResponse: unknown) {
      isLoading.value = true;
      error.value = null;
      loginRequires2FA.value = false;
      try {
        const response = await apiClient.post<{ message: string; user: UserInfo }>(
          '/auth/passkey/authenticate',
          { username, assertionResponse }
        );
        isAuthenticated.value = true;
        user.value = response.data.user;
        log.info('Passkey 登录成功:', user.value);
        if (user.value?.language) {
          setLocale(user.value.language);
        }
        window.location.href = '/';
        return { success: true };
      } catch (err: unknown) {
        log.error('Passkey 登录失败:', err);
        isAuthenticated.value = false;
        user.value = null;
        error.value = extractErrorMessage(err, '');
        return { success: false, error: error.value };
      } finally {
        isLoading.value = false;
      }
    }

    /**
     * Fetches server-generated passkey (WebAuthn) registration options for the given username.
     *
     * @param username - The account username for which to request registration options
     * @returns The registration options object (challenge and parameters) required to create a passkey
     * @throws An Error with a user-facing message when the request to obtain registration options fails
     */
    async function getPasskeyRegistrationOptions(username: string) {
      isLoading.value = true;
      error.value = null;
      try {
        const response = await apiClient.post('/auth/passkey/registration-options', { username });
        return response.data;
      } catch (err: unknown) {
        log.error('获取 Passkey 注册选项失败:', err);
        error.value = extractErrorMessage(err, '');
        throw new Error(error.value ?? '获取 Passkey 注册选项失败。');
      } finally {
        isLoading.value = false;
      }
    }

    /**
     * Register a new passkey credential for the specified username.
     *
     * @param username - The account username to associate the passkey with
     * @param registrationResponse - The authenticator's registration response payload (opaque)
     * @returns An object with `success: true` when registration completes successfully
     * @throws An `Error` containing a user-facing message when registration fails
     */
    async function registerPasskey(username: string, registrationResponse: unknown) {
      isLoading.value = true;
      error.value = null;
      try {
        await apiClient.post('/auth/passkey/register', {
          username,
          registrationResponse,
        });
        log.info('Passkey 注册成功');
        return { success: true };
      } catch (err: unknown) {
        log.error('Passkey 注册失败:', err);
        error.value = extractErrorMessage(err, '');
        throw new Error(error.value ?? 'Passkey 注册失败。');
      } finally {
        isLoading.value = false;
      }
    }

    /**
     * Fetches the current user's passkeys from the backend and updates store state.
     *
     * If the user is not authenticated, clears the passkeys list and returns immediately.
     * On success, maps backend fields into `PasskeyInfo` objects and sets `passkeys`.
     * On failure, sets `error` with the extracted message and clears `passkeys`.
     */
    async function fetchPasskeys() {
      if (!isAuthenticated.value) {
        log.warn('User not authenticated. Cannot fetch passkeys.');
        passkeys.value = null;
        return;
      }
      passkeysLoading.value = true;
      error.value = null;
      try {
        interface BackendPasskeyInfo {
          credential_id: string;
          public_key: string;
          counter: number;
          transports?: AuthenticatorTransport[];
          created_at: string;
          last_used_at: string;
          name?: string;
        }
        const response = await apiClient.get<BackendPasskeyInfo[]>('/passkey');
        passkeys.value = response.data.map((pk) => ({
          credentialID: pk.credential_id,
          publicKey: pk.public_key,
          counter: pk.counter,
          transports: pk.transports,
          creationDate: pk.created_at,
          lastUsedDate: pk.last_used_at,
          name: pk.name,
        }));
        log.info('Passkeys fetched and mapped successfully:', passkeys.value);
      } catch (err: unknown) {
        log.error('Failed to fetch passkeys:', err);
        error.value = extractErrorMessage(err, '');
        passkeys.value = null;
      } finally {
        passkeysLoading.value = false;
      }
    }

    /**
     * Delete a passkey by its credential ID and refresh the stored passkey list.
     *
     * @param credentialID - The credential ID of the passkey to delete
     * @returns An object with `success: true` when the passkey is deleted
     * @throws Error if the current user is not authenticated
     * @throws Error if deletion fails; error message contains server-provided text or a fallback message
     */
    async function deletePasskey(credentialID: string) {
      if (!isAuthenticated.value) {
        throw new Error('User not authenticated. Cannot delete passkey.');
      }
      isLoading.value = true;
      error.value = null;
      try {
        await apiClient.delete(`/passkey/${credentialID}`);
        log.info(`Passkey ${credentialID} deleted successfully.`);
        await fetchPasskeys();
        return { success: true };
      } catch (err: unknown) {
        log.error(`Failed to delete passkey ${credentialID}:`, err);
        error.value = extractErrorMessage(err, '');
        throw new Error(error.value ?? 'Failed to delete passkey.');
      } finally {
        isLoading.value = false;
      }
    }

    /**
     * Update the display name of a passkey credential and refresh the local passkey list.
     *
     * @param credentialID - The credential identifier of the passkey to rename
     * @param newName - The new display name to assign to the passkey
     * @returns An object `{ success: true }` when the update succeeds
     * @throws Error if the user is not authenticated
     * @throws Error if the API request to update the passkey name fails
     */
    async function updatePasskeyName(credentialID: string, newName: string) {
      if (!isAuthenticated.value) {
        throw new Error('User not authenticated. Cannot update passkey name.');
      }
      error.value = null;
      try {
        await apiClient.put(`/passkey/${credentialID}/name`, { name: newName });
        log.info(`Passkey ${credentialID} name updated to "${newName}".`);
        await fetchPasskeys();
        return { success: true };
      } catch (err: unknown) {
        log.error(`Failed to update passkey ${credentialID} name:`, err);
        error.value = extractErrorMessage(err, '');
        throw new Error(error.value ?? 'Failed to update passkey name.');
      }
    }

    /**
     * Checks whether passkeys are configured, optionally for a specific username.
     *
     * @param username - Optional username to check; when omitted, checks availability for any user
     * @returns `true` if passkeys are configured (for the given username or generally), `false` otherwise
     */
    async function checkHasPasskeysConfigured(username?: string) {
      try {
        const params = username ? { username } : {};
        const response = await apiClient.get<{ hasPasskeys: boolean }>(
          '/auth/passkey/has-configured',
          { params }
        );
        hasPasskeysAvailable.value = response.data.hasPasskeys;
        log.info(
          `[AuthStore] Passkeys available for ${username || 'any user'}: ${hasPasskeysAvailable.value}`
        );
        return hasPasskeysAvailable.value;
      } catch (err: unknown) {
        log.error(
          'Failed to check if passkeys are configured:',
          extractErrorMessage(err, 'Failed to check if passkeys are configured')
        );
        hasPasskeysAvailable.value = false;
        return false;
      }
    }

    /**
     * Loads initial authentication, setup, user, and public CAPTCHA configuration from the server and applies them to the store state.
     *
     * On success, updates `needsSetup`, `isAuthenticated`, `user`, `publicCaptchaConfig`, and `isInitCompleted`, applies the user's locale if present, and logs the result.
     * On failure, logs the error, ensures `isInitCompleted` is set to `true`, and if no user is present and the app appears unauthenticated, sets `needsSetup` to `true`.
     *
     * The function validates the CAPTCHA provider returned by the server and treats an invalid provider as a failed initialization.
     */
    async function loadInitData() {
      isLoading.value = true;
      try {
        const response = await apiClient.get<{
          needsSetup: boolean;
          isAuthenticated: boolean;
          user: UserInfo | null;
          captchaConfig: {
            enabled: boolean;
            provider: string;
            hcaptchaSiteKey: string | null;
            recaptchaSiteKey: string | null;
          };
        }>('/auth/init');

        const provider = response.data.captchaConfig.provider;
        const validProviders = ['none', 'hcaptcha', 'recaptcha'] as const;
        if (!validProviders.includes(provider as (typeof validProviders)[number])) {
          throw new Error(`无效的 CAPTCHA provider: ${provider}`);
        }

        needsSetup.value = response.data.needsSetup;
        isAuthenticated.value = response.data.isAuthenticated;
        user.value = response.data.user;
        publicCaptchaConfig.value = {
          enabled: response.data.captchaConfig.enabled,
          provider: provider as 'none' | 'hcaptcha' | 'recaptcha',
          hcaptchaSiteKey: response.data.captchaConfig.hcaptchaSiteKey ?? undefined,
          recaptchaSiteKey: response.data.captchaConfig.recaptchaSiteKey ?? undefined,
        };

        if (user.value?.language) {
          setLocale(user.value.language);
        }

        isInitCompleted.value = true;

        log.info('[AuthStore] 统一初始化数据加载完成:', {
          needsSetup: needsSetup.value,
          isAuthenticated: isAuthenticated.value,
          user: user.value,
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const axiosError = err as { response?: { data?: { message?: string } } };
        const serverMessage = axiosError.response?.data?.message;

        log.error('[AuthStore] 加载初始化数据失败:', serverMessage || errorMessage);

        isInitCompleted.value = true;

        if (user.value === null && needsSetup.value === false && isAuthenticated.value === false) {
          needsSetup.value = true;
        }
      } finally {
        isLoading.value = false;
      }
    }

    return {
      isAuthenticated,
      user,
      isLoading,
      error,
      loginRequires2FA,
      tempToken,
      ipBlacklist,
      needsSetup,
      publicCaptchaConfig,
      passkeys,
      passkeysLoading,
      hasPasskeysAvailable,
      isInitCompleted,
      loggedInUser,
      clearError,
      setError,
      login,
      verifyLogin2FA,
      logout,
      checkAuthStatus,
      changePassword,
      fetchIpBlacklist,
      deleteIpFromBlacklist,
      checkSetupStatus,
      fetchCaptchaConfig,
      loginWithPasskey,
      getPasskeyRegistrationOptions,
      registerPasskey,
      fetchPasskeys,
      deletePasskey,
      updatePasskeyName,
      checkHasPasskeysConfigured,
      loadInitData,
    };
  },
  {
    persist: true,
  }
);
