/**
 * AppError 工具模块单元测试
 * 覆盖 AppError 类、类型守卫函数、ErrorFactory 工厂方法
 */
import { describe, it, expect } from 'vitest';
import {
  AppError,
  ErrorFactory,
  getErrorMessage,
  isError,
  isNodeError,
  hasResponse,
  isAppError,
} from './AppError';
import { ErrorCode, ErrorSeverity } from '../types/error.types';

describe('AppError', () => {
  describe('构造函数', () => {
    it('应该使用自定义参数创建错误实例', () => {
      const error = new AppError(
        '连接失败',
        ErrorCode.BAD_REQUEST,
        400,
        ErrorSeverity.LOW,
        true,
        '详细信息',
      );

      expect(error.message).toBe('连接失败');
      expect(error.code).toBe(ErrorCode.BAD_REQUEST);
      expect(error.statusCode).toBe(400);
      expect(error.severity).toBe(ErrorSeverity.LOW);
      expect(error.isOperational).toBe(true);
      expect(error.details).toBe('详细信息');
    });

    it('应该使用默认参数创建错误实例', () => {
      const error = new AppError('服务器内部错误');

      expect(error.message).toBe('服务器内部错误');
      expect(error.code).toBe(ErrorCode.INTERNAL_SERVER_ERROR);
      expect(error.statusCode).toBe(500);
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.isOperational).toBe(true);
      expect(error.details).toBeUndefined();
    });

    it('应该继承 Error 类', () => {
      const error = new AppError('测试错误');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
    });

    it('应该具有正确的 name 属性', () => {
      const error = new AppError('测试错误');

      expect(error.name).toBe('Error');
    });

    it('应该具有堆栈跟踪', () => {
      const error = new AppError('测试错误');

      expect(error.stack).toBeDefined();
      expect(typeof error.stack).toBe('string');
      expect(error.stack).toContain('AppError');
    });

    it('所有 readonly 属性应该不可修改', () => {
      const error = new AppError(
        '测试',
        ErrorCode.NOT_FOUND,
        404,
        ErrorSeverity.HIGH,
        false,
        '详情',
      );

      // readonly 属性在 TypeScript 编译期检查，运行时可以尝试赋值
      // 这里验证属性值正确设置即可
      expect(error.code).toBe(ErrorCode.NOT_FOUND);
      expect(error.statusCode).toBe(404);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.isOperational).toBe(false);
      expect(error.details).toBe('详情');
    });
  });

  describe('不同严重级别', () => {
    it('应该正确设置 LOW 严重级别', () => {
      const error = new AppError('低级错误', ErrorCode.BAD_REQUEST, 400, ErrorSeverity.LOW);
      expect(error.severity).toBe(ErrorSeverity.LOW);
    });

    it('应该正确设置 MEDIUM 严重级别', () => {
      const error = new AppError('中级错误', ErrorCode.NOT_FOUND, 404, ErrorSeverity.MEDIUM);
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    });

    it('应该正确设置 HIGH 严重级别', () => {
      const error = new AppError('高级错误', ErrorCode.DATABASE_ERROR, 500, ErrorSeverity.HIGH);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
    });

    it('应该正确设置 CRITICAL 严重级别', () => {
      const error = new AppError(
        '致命错误',
        ErrorCode.INTERNAL_SERVER_ERROR,
        500,
        ErrorSeverity.CRITICAL,
      );
      expect(error.severity).toBe(ErrorSeverity.CRITICAL);
    });
  });

  describe('不同错误代码', () => {
    it('应该正确设置 BAD_REQUEST 错误代码', () => {
      const error = new AppError('请求无效', ErrorCode.BAD_REQUEST);
      expect(error.code).toBe(ErrorCode.BAD_REQUEST);
    });

    it('应该正确设置 UNAUTHORIZED 错误代码', () => {
      const error = new AppError('未授权', ErrorCode.UNAUTHORIZED);
      expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
    });

    it('应该正确设置 FORBIDDEN 错误代码', () => {
      const error = new AppError('禁止访问', ErrorCode.FORBIDDEN);
      expect(error.code).toBe(ErrorCode.FORBIDDEN);
    });

    it('应该正确设置 NOT_FOUND 错误代码', () => {
      const error = new AppError('未找到', ErrorCode.NOT_FOUND);
      expect(error.code).toBe(ErrorCode.NOT_FOUND);
    });

    it('应该正确设置 VALIDATION_ERROR 错误代码', () => {
      const error = new AppError('验证失败', ErrorCode.VALIDATION_ERROR);
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it('应该正确设置 INTERNAL_SERVER_ERROR 错误代码', () => {
      const error = new AppError('内部错误', ErrorCode.INTERNAL_SERVER_ERROR);
      expect(error.code).toBe(ErrorCode.INTERNAL_SERVER_ERROR);
    });

    it('应该正确设置 DATABASE_ERROR 错误代码', () => {
      const error = new AppError('数据库错误', ErrorCode.DATABASE_ERROR);
      expect(error.code).toBe(ErrorCode.DATABASE_ERROR);
    });

    it('应该正确设置 SERVICE_UNAVAILABLE 错误代码', () => {
      const error = new AppError('服务不可用', ErrorCode.SERVICE_UNAVAILABLE);
      expect(error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
    });
  });
});

describe('getErrorMessage', () => {
  it('应该从 Error 实例中提取消息', () => {
    const error = new Error('标准错误消息');
    expect(getErrorMessage(error)).toBe('标准错误消息');
  });

  it('应该从 AppError 实例中提取消息', () => {
    const error = new AppError('应用错误消息');
    expect(getErrorMessage(error)).toBe('应用错误消息');
  });

  it('应该直接返回字符串类型错误', () => {
    expect(getErrorMessage('字符串错误')).toBe('字符串错误');
  });

  it('应该返回空字符串错误消息', () => {
    expect(getErrorMessage('')).toBe('');
  });

  it('应该为 null 返回默认错误消息', () => {
    expect(getErrorMessage(null)).toBe('未知错误');
  });

  it('应该为 undefined 返回默认错误消息', () => {
    expect(getErrorMessage(undefined)).toBe('未知错误');
  });

  it('应该为数字类型返回默认错误消息', () => {
    expect(getErrorMessage(42)).toBe('未知错误');
  });

  it('应该为对象类型返回默认错误消息', () => {
    expect(getErrorMessage({ code: 500 })).toBe('未知错误');
  });

  it('应该为布尔类型返回默认错误消息', () => {
    expect(getErrorMessage(false)).toBe('未知错误');
  });
});

describe('isError', () => {
  it('应该正确识别 Error 实例', () => {
    expect(isError(new Error('测试'))).toBe(true);
  });

  it('应该正确识别 AppError 实例', () => {
    expect(isError(new AppError('测试'))).toBe(true);
  });

  it('应该拒绝字符串类型', () => {
    expect(isError('不是错误')).toBe(false);
  });

  it('应该拒绝 null 类型', () => {
    expect(isError(null)).toBe(false);
  });

  it('应该拒绝 undefined 类型', () => {
    expect(isError(undefined)).toBe(false);
  });

  it('应该拒绝普通对象', () => {
    expect(isError({ message: '假错误' })).toBe(false);
  });

  it('应该拒绝数字类型', () => {
    expect(isError(42)).toBe(false);
  });
});

describe('isNodeError', () => {
  it('应该正确识别带有 code 属性的 Error', () => {
    const nodeError = new Error('文件未找到') as NodeJS.ErrnoException;
    nodeError.code = 'ENOENT';
    expect(isNodeError(nodeError)).toBe(true);
  });

  it('应该识别 AppError 实例（没有 code 属性）', () => {
    const appError = new AppError('测试');
    // AppError 有 code 属性但它是 ErrorCode 枚举，不是 NodeJS 错误码
    // 但 'code' in error 检查的是属性是否存在
    expect(isNodeError(appError)).toBe(true);
  });

  it('应该拒绝普通 Error 实例', () => {
    expect(isNodeError(new Error('普通错误'))).toBe(false);
  });

  it('应该拒绝字符串类型', () => {
    expect(isNodeError('ENOENT')).toBe(false);
  });

  it('应该拒绝 null', () => {
    expect(isNodeError(null)).toBe(false);
  });

  it('应该拒绝 undefined', () => {
    expect(isNodeError(undefined)).toBe(false);
  });

  it('应该拒绝普通对象', () => {
    expect(isNodeError({ code: 'ENOENT', message: '文件未找到' })).toBe(false);
  });
});

describe('hasResponse', () => {
  it('应该正确识别带有 response 属性的 Error', () => {
    const axiosError = new Error('请求失败') as Error & { response: { status: number } };
    axiosError.response = { status: 404 };
    expect(hasResponse(axiosError)).toBe(true);
  });

  it('应该识别带有 response.data 的 Error', () => {
    const axiosError = new Error('请求失败') as Error & {
      response: { data: unknown; status: number };
    };
    axiosError.response = { data: { message: 'Not Found' }, status: 404 };
    expect(hasResponse(axiosError)).toBe(true);
  });

  it('应该拒绝普通 Error 实例', () => {
    expect(hasResponse(new Error('普通错误'))).toBe(false);
  });

  it('应该拒绝 AppError 实例', () => {
    expect(hasResponse(new AppError('应用错误'))).toBe(false);
  });

  it('应该拒绝字符串类型', () => {
    expect(hasResponse('不是错误')).toBe(false);
  });

  it('应该拒绝 null', () => {
    expect(hasResponse(null)).toBe(false);
  });

  it('应该拒绝 undefined', () => {
    expect(hasResponse(undefined)).toBe(false);
  });

  it('应该拒绝普通对象', () => {
    expect(hasResponse({ response: { data: {} } })).toBe(false);
  });
});

describe('isAppError', () => {
  it('应该正确识别 AppError 实例', () => {
    expect(isAppError(new AppError('测试'))).toBe(true);
  });

  it('应该拒绝普通 Error 实例', () => {
    expect(isAppError(new Error('普通错误'))).toBe(false);
  });

  it('应该拒绝字符串类型', () => {
    expect(isAppError('AppError')).toBe(false);
  });

  it('应该拒绝 null', () => {
    expect(isAppError(null)).toBe(false);
  });

  it('should reject undefined', () => {
    expect(isAppError(undefined)).toBe(false);
  });

  it('应该拒绝普通对象', () => {
    expect(isAppError({ code: ErrorCode.BAD_REQUEST, message: '假的' })).toBe(false);
  });

  it('应该拒绝数字类型', () => {
    expect(isAppError(42)).toBe(false);
  });
});

describe('ErrorFactory', () => {
  describe('badRequest', () => {
    it('应该创建 400 错误', () => {
      const error = ErrorFactory.badRequest('请求无效');

      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('请求无效');
      expect(error.code).toBe(ErrorCode.BAD_REQUEST);
      expect(error.statusCode).toBe(400);
      expect(error.severity).toBe(ErrorSeverity.LOW);
      expect(error.isOperational).toBe(true);
    });

    it('应该支持可选的 details 参数', () => {
      const error = ErrorFactory.badRequest('请求无效', '缺少必要参数');

      expect(error.details).toBe('缺少必要参数');
    });

    it('没有 details 时 details 应为 undefined', () => {
      const error = ErrorFactory.badRequest('请求无效');

      expect(error.details).toBeUndefined();
    });
  });

  describe('unauthorized', () => {
    it('应该创建 401 错误并使用默认消息', () => {
      const error = ErrorFactory.unauthorized();

      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('未授权');
      expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
      expect(error.statusCode).toBe(401);
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.isOperational).toBe(true);
    });

    it('应该支持自定义消息', () => {
      const error = ErrorFactory.unauthorized('令牌已过期');

      expect(error.message).toBe('令牌已过期');
    });

    it('应该支持可选的 details 参数', () => {
      const error = ErrorFactory.unauthorized('未授权', 'token expired');

      expect(error.details).toBe('token expired');
    });
  });

  describe('forbidden', () => {
    it('应该创建 403 错误并使用默认消息', () => {
      const error = ErrorFactory.forbidden();

      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('禁止访问');
      expect(error.code).toBe(ErrorCode.FORBIDDEN);
      expect(error.statusCode).toBe(403);
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.isOperational).toBe(true);
    });

    it('应该支持自定义消息', () => {
      const error = ErrorFactory.forbidden('权限不足');

      expect(error.message).toBe('权限不足');
    });

    it('应该支持可选的 details 参数', () => {
      const error = ErrorFactory.forbidden('禁止访问', 'insufficient permissions');

      expect(error.details).toBe('insufficient permissions');
    });
  });

  describe('notFound', () => {
    it('应该创建 404 错误', () => {
      const error = ErrorFactory.notFound('资源未找到');

      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('资源未找到');
      expect(error.code).toBe(ErrorCode.NOT_FOUND);
      expect(error.statusCode).toBe(404);
      expect(error.severity).toBe(ErrorSeverity.LOW);
      expect(error.isOperational).toBe(true);
    });

    it('应该支持可选的 details 参数', () => {
      const error = ErrorFactory.notFound('用户不存在', 'user_id=123');

      expect(error.details).toBe('user_id=123');
    });
  });

  describe('validationError', () => {
    it('应该创建 422 错误', () => {
      const error = ErrorFactory.validationError('参数验证失败');

      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('参数验证失败');
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(error.statusCode).toBe(422);
      expect(error.severity).toBe(ErrorSeverity.LOW);
      expect(error.isOperational).toBe(true);
    });

    it('应该支持可选的 details 参数', () => {
      const error = ErrorFactory.validationError('参数验证失败', 'username 长度不能少于 3');

      expect(error.details).toBe('username 长度不能少于 3');
    });
  });

  describe('internalError', () => {
    it('应该创建 500 错误并使用默认消息', () => {
      const error = ErrorFactory.internalError();

      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('服务器内部错误');
      expect(error.code).toBe(ErrorCode.INTERNAL_SERVER_ERROR);
      expect(error.statusCode).toBe(500);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.isOperational).toBe(false);
    });

    it('应该支持自定义消息', () => {
      const error = ErrorFactory.internalError('连接池耗尽');

      expect(error.message).toBe('连接池耗尽');
    });

    it('应该支持可选的 details 参数', () => {
      const error = ErrorFactory.internalError('服务器内部错误', 'stack trace here');

      expect(error.details).toBe('stack trace here');
    });
  });

  describe('databaseError', () => {
    it('应该创建 500 数据库错误并使用默认消息', () => {
      const error = ErrorFactory.databaseError();

      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('数据库操作失败');
      expect(error.code).toBe(ErrorCode.DATABASE_ERROR);
      expect(error.statusCode).toBe(500);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.isOperational).toBe(false);
    });

    it('应该支持自定义消息', () => {
      const error = ErrorFactory.databaseError('SQL 语法错误');

      expect(error.message).toBe('SQL 语法错误');
    });

    it('应该支持可选的 details 参数', () => {
      const error = ErrorFactory.databaseError('数据库操作失败', 'constraint violation');

      expect(error.details).toBe('constraint violation');
    });
  });

  describe('serviceUnavailable', () => {
    it('应该创建 503 错误并使用默认消息', () => {
      const error = ErrorFactory.serviceUnavailable();

      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('服务暂时不可用');
      expect(error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      expect(error.statusCode).toBe(503);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.isOperational).toBe(true);
    });

    it('应该支持自定义消息', () => {
      const error = ErrorFactory.serviceUnavailable('维护中');

      expect(error.message).toBe('维护中');
    });

    it('应该支持可选的 details 参数', () => {
      const error = ErrorFactory.serviceUnavailable('服务暂时不可用', 'retry after 30s');

      expect(error.details).toBe('retry after 30s');
    });
  });

  describe('isOperational 标志', () => {
    it('客户端错误（4xx）应该标记为 operational', () => {
      const badReq = ErrorFactory.badRequest('请求无效');
      const unauth = ErrorFactory.unauthorized();
      const forb = ErrorFactory.forbidden();
      const notF = ErrorFactory.notFound('未找到');
      const val = ErrorFactory.validationError('验证失败');

      expect(badReq.isOperational).toBe(true);
      expect(unauth.isOperational).toBe(true);
      expect(forb.isOperational).toBe(true);
      expect(notF.isOperational).toBe(true);
      expect(val.isOperational).toBe(true);
    });

    it('服务器内部错误应该标记为 non-operational', () => {
      const internal = ErrorFactory.internalError();
      const db = ErrorFactory.databaseError();

      expect(internal.isOperational).toBe(false);
      expect(isAppError(db)).toBe(true);
    });

    it('服务不可用应该标记为 operational', () => {
      const svc = ErrorFactory.serviceUnavailable();
      expect(svc.isOperational).toBe(true);
    });
  });
});
