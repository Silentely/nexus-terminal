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
    const multiplexEnabled = ref(false);

    // --- Getters ---
    const loggedInUser = computed(() => user.value?.username);

    /**
     * Clear the current authentication error state.
     *
     * Sets the store's `error` value to `null`.
     */
    function clearError() {
      error.value = null;
    }

    /**
     * Sets the store's current error message.
     *
     * @param errorMessage - The error message to set
     */
    function setError(errorMessage: string) {
      error.value = errorMessage;
    }

    /**
     * Attempt to authenticate a user with credentials and an optional CAPTCHA token, updating the auth store state and initiating post-login navigation when applicable.
     *
     * @param payload - Login credentials and optional `captchaToken` for server-side CAPTCHA verification.
     * @returns An object indicating one of:
     *  - `{ requiresTwoFactor: true }` when the server requires two-factor verification (a temporary token is stored);
     *  - `{ success: true }` when login succeeded and the authenticated user has been set (navigation to `/` is triggered);
     *  - `{ success: false, error: string }` when login failed, with an error message describing the failure.
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
     * Finalize a login by validating the two-factor authentication token.
     *
     * @param token - The 2FA token submitted by the user to complete authentication
     * @returns `{ success: true }` if verification succeeds, `{ success: false, error: string }` if verification fails
     * @throws Error when the current login flow does not require two-factor verification
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
          { token, tempToken: tempToken.value },
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
     * Performs a server-side logout, clears local authentication state, and navigates to the login page.
     *
     * On failure, records a human-readable error message in the store's `error` state and leaves the client unauthenticated state cleared. */
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
     * Reconciles authentication state with the backend and updates the store accordingly.
     *
     * Queries `/auth/status` and sets `isAuthenticated`, `user`, and `loginRequires2FA` based on the response.
     * If a user is returned and includes a `language`, calls `setLocale` with that language.
     * On failure, clears authentication state (`isAuthenticated` false, `user` null, `loginRequires2FA` false).
     */
    async function checkAuthStatus() {
      isLoading.value = true;
      try {
        const response = await apiClient.get<{ isAuthenticated: boolean; user: UserInfo }>(
          '/auth/status',
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
     * Change the currently authenticated user's password.
     *
     * @param currentPassword - The user's current password
     * @param newPassword - The new password to set
     * @returns `true` if the password was changed successfully
     * @throws Error if the caller is not authenticated, or if the server rejects the change (an error message is stored in the store's `error` ref)
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
     * Retrieve a paginated list of IP blacklist entries from the backend.
     *
     * @param limit - Maximum number of entries to return (page size)
     * @param offset - Number of entries to skip (pagination offset)
     * @returns The response data containing `entries` (array of IP blacklist entries) and `total` (total number of entries)
     * @throws Error with the server-derived message or a fallback when the request fails
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
     * @returns `true` if the IP was successfully deleted
     * @throws Error when the deletion fails (error message is set on the store)
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
     * Checks whether the application requires initial setup by querying the backend and updates the store state.
     *
     * Updates the `needsSetup` store ref with the server result before returning it.
     *
     * @returns `true` if setup is required, `false` otherwise.
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
     * Loads server CAPTCHA settings and updates the store's publicCaptchaConfig.
     *
     * Derives a public-facing config (enabled, provider, and public site keys) from GET /settings/captcha
     * and assigns it to `publicCaptchaConfig`. On failure, sets `publicCaptchaConfig` to `{ enabled: false, provider: 'none' }`.
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
          publicCaptchaConfig.value,
        );
      } catch (err: unknown) {
        log.error(
          '获取 CAPTCHA 配置失败 (from /settings/captcha):',
          extractErrorMessage(err, '获取 CAPTCHA 配置失败'),
        );
        publicCaptchaConfig.value = {
          enabled: false,
          provider: 'none',
        };
      }
    }

    /**
     * Authenticates a user using a passkey (WebAuthn) assertion and navigates to the application root on success.
     *
     * @param username - The account username to authenticate.
     * @param assertionResponse - The client-side WebAuthn assertion response produced by navigator.credentials.get.
     * @returns An object with `success: true` on successful authentication, or `success: false` and `error` containing a message on failure
     */
    async function loginWithPasskey(username: string, assertionResponse: unknown) {
      isLoading.value = true;
      error.value = null;
      loginRequires2FA.value = false;
      try {
        const response = await apiClient.post<{ message: string; user: UserInfo }>(
          '/auth/passkey/authenticate',
          { username, assertionResponse },
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
     * @returns The server-provided registration options object required to create a new passkey credential.
     * @throws Error when the backend request fails; error message contains the extracted failure reason.
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
     * Register a WebAuthn passkey for the given username.
     *
     * @param username - Account username to associate with the new passkey.
     * @param registrationResponse - The browser's WebAuthn registration response (credential data) to send to the server.
     * @returns An object with `success: true` when registration succeeds.
     * @throws Error with the server-provided message or 'Passkey registration failed.' when registration fails.
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
     * Fetches the current user's passkeys from the backend and updates the store state.
     *
     * If the user is not authenticated, clears `passkeys` and returns immediately. While running,
     * sets `passkeysLoading` to true and clears previous `error`. On success, maps backend passkey
     * fields to the store's `PasskeyInfo` shape and assigns the list to `passkeys`. On failure,
     * sets `error` and clears `passkeys`. Always resets `passkeysLoading` when finished.
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
     * Deletes a registered passkey by credential ID and refreshes the local passkey list.
     *
     * @param credentialID - The passkey credential ID to remove
     * @returns An object with `success: true` when the passkey was deleted
     * @throws If the current user is not authenticated
     * @throws If the deletion request fails; the store's `error` will be set to the backend message when available and an `Error` is thrown
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
     * Updates the display name for a passkey credential and refreshes the local passkey list.
     *
     * @param credentialID - The passkey credential identifier to rename
     * @param newName - The new name to assign to the passkey
     * @returns An object with `success: true` when the update completes
     * @throws Error if the user is not authenticated or if the update fails
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
     * Determines whether passkey authentication has been configured (globally or for a specific user).
     *
     * @param username - Optional username to check passkey configuration for; if omitted, checks whether any user has passkeys configured
     * @returns `true` if passkeys are configured (for the given username when provided, otherwise for any user), `false` otherwise
     */
    async function checkHasPasskeysConfigured(username?: string) {
      try {
        const params = username ? { username } : {};
        const response = await apiClient.get<{ hasPasskeys: boolean }>(
          '/auth/passkey/has-configured',
          { params },
        );
        hasPasskeysAvailable.value = response.data.hasPasskeys;
        log.info(
          `[AuthStore] Passkeys available for ${username || 'any user'}: ${hasPasskeysAvailable.value}`,
        );
        return hasPasskeysAvailable.value;
      } catch (err: unknown) {
        log.error(
          'Failed to check if passkeys are configured:',
          extractErrorMessage(err, 'Failed to check if passkeys are configured'),
        );
        hasPasskeysAvailable.value = false;
        return false;
      }
    }

    /**
     * Initialize authentication state and public CAPTCHA configuration from the backend.
     *
     * Fetches initialization data and updates the store's `needsSetup`, `isAuthenticated`, `user`, and `publicCaptchaConfig` values; applies the user's language to the app locale when provided and marks initialization as completed.
     *
     * @throws Error if the backend returns an invalid CAPTCHA provider.
     *
     * On failure the function still sets `isInitCompleted` to `true` and, if no user is present while `needsSetup` is false and `isAuthenticated` is false, forces `needsSetup` to `true`.
     */
    async function loadInitData() {
      isLoading.value = true;
      // 重置为默认值，避免 localStorage 中的陈旧值在 /auth/init 失败时被沿用
      multiplexEnabled.value = false;
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
          multiplexEnabled: boolean;
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
        multiplexEnabled.value = response.data.multiplexEnabled ?? false;

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
      multiplexEnabled,
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
  },
);
