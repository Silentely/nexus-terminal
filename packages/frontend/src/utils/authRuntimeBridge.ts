type UnauthorizedLogoutHandler = () => boolean | Promise<boolean>;
type LogoutRedirectHandler = () => void | Promise<void>;

// 运行时注册的 401 处理器，避免 apiClient 静态依赖 auth store
let unauthorizedLogoutHandler: UnauthorizedLogoutHandler | null = null;
// 运行时注册的登出跳转处理器，避免 auth store 静态依赖 router
let logoutRedirectHandler: LogoutRedirectHandler | null = null;

export const registerUnauthorizedLogoutHandler = (
  handler: UnauthorizedLogoutHandler | null,
): void => {
  unauthorizedLogoutHandler = handler;
};

export const handleUnauthorizedLogout = async (): Promise<boolean> => {
  if (!unauthorizedLogoutHandler) {
    return false;
  }
  return unauthorizedLogoutHandler();
};

export const registerLogoutRedirectHandler = (handler: LogoutRedirectHandler | null): void => {
  logoutRedirectHandler = handler;
};

export const navigateToLoginAfterLogout = async (): Promise<void> => {
  if (logoutRedirectHandler) {
    await logoutRedirectHandler();
    return;
  }
  window.location.href = '/login';
};
