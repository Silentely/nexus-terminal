# 星枢终端 - 技术债务报告

> **生成时间**：2025-12-23
> **扫描范围**：packages/backend 和 packages/frontend
> **任务**：【P3-2】整理 TODO/FIXME 到 GitHub Issues
> **状态**：✅ **全部修复完成** (2025-12-24)

---

## 🎉 修复状态概要

| 优先级      | 总计   | 已修复 | 状态        |
| ----------- | ------ | ------ | ----------- |
| 🔴 高优先级 | 7      | 7      | ✅ 100%     |
| 🟡 中优先级 | 12     | 12     | ✅ 100%     |
| 🟢 低优先级 | 5      | 5      | ✅ 100%     |
| **总计**    | **24** | **24** | ✅ **100%** |

**修复时间**：2025-12-24

---

## 执行摘要

本次扫描发现代码库中共有 **24 个技术债务标记**，分布在 backend（11个）和 frontend（13个）模块中。

> ✅ **2025-12-24 更新**：所有技术债务已全部修复完成！

**严重程度分布**：

- 🔴 **高优先级**（影响功能完整性或用户体验）：7 个 ✅
- 🟡 **中优先级**（代码质量或可维护性）：12 个 ✅
- 🟢 **低优先级**（优化项或增强项）：5 个 ✅

**按模块分类**：

- 📦 **Backend**：11 个 TODO ✅
- 🎨 **Frontend**：13 个 TODO ✅

---

## 一、Backend 模块技术债务

### 🔴 高优先级（3个）

#### 1. Payload 验证缺失

**文件**：`packages/backend/src/transfers/transfers.controller.ts:28`
**代码**：

```typescript
// TODO: 添加payload验证逻辑
```

**问题描述**：文件传输控制器缺少请求 payload 的验证逻辑，存在潜在的安全风险。

**建议方案**：

- 使用 Zod 或 Joi 添加请求体 schema 验证
- 验证文件路径、大小、类型等参数
- 集成到现有的中间件链中

**优先级理由**：涉及文件传输的安全性，应尽快补充。

---

#### 2. 审计日志类型未定义

**文件**：`packages/backend/src/connections/connection.service.ts:737`
**代码**：

```typescript
// TODO: 定义 'CONNECTIONS_TAG_ADDED' 审计日志类型
```

**问题描述**：连接标签添加操作缺少对应的审计日志类型定义。

**建议方案**：

- 在 `src/audit/audit.types.ts` 中添加 `CONNECTIONS_TAG_ADDED` 类型
- 统一审计日志类型命名规范（使用枚举）
- 确保所有关键操作都有对应的审计日志类型

**优先级理由**：审计完整性是安全合规的基础。

---

#### 3. 用户语言偏好硬编码

**文件**：`packages/backend/src/notifications/notification.processor.service.ts:94,135`
**代码**：

```typescript
// TODO: 获取用户语言偏好，目前硬编码为 'zh-CN'
const userLang = 'zh-CN'; // TODO: Get user language preference
```

**问题描述**：通知系统的语言偏好硬编码为简体中文，无法支持国际化。

**建议方案**：

- 在用户表中添加 `preferred_language` 字段
- 在通知上下文中传递用户语言偏好
- 支持 `Accept-Language` HTTP 头或客户端语言设置

**优先级理由**：影响国际化用户体验。

---

### 🟡 中优先级（6个）

#### 4. SSH 会话持久化恢复（3处）

**文件**：`packages/backend/src/ssh-suspend/ssh-suspend.service.ts:27,262,459`
**代码**：

```typescript
// TODO: 考虑在服务启动时从日志目录加载持久化的 'disconnected_by_backend' 会话信息。
// TODO: 增强此方法以从日志目录恢复 'disconnected_by_backend' 的会话状态，
// TODO: 如果设计要求将自定义名称持久化到日志文件的元数据部分，
```

**问题描述**：SSH 挂起功能缺少从日志目录恢复会话状态的能力，服务重启后会话信息可能丢失。

**建议方案**：

- 设计会话元数据的 JSON 格式（包含 session_id、自定义名称、创建时间等）
- 在服务启动时扫描日志目录并恢复会话状态
- 添加会话元数据的持久化逻辑

**优先级理由**：提升服务可靠性，但非紧急功能。

---

#### 5. 文件删除信号支持

**文件**：`packages/backend/src/transfers/transfers.service.ts:1171`
**代码**：

```typescript
// TODO: Make deleteFileOnSourceViaSftp accept signal
```

**问题描述**：SFTP 文件删除操作不支持取消信号（AbortController）。

**建议方案**：

- 为 `deleteFileOnSourceViaSftp` 方法添加 `signal?: AbortSignal` 参数
- 在执行删除前检查 signal 状态
- 统一文件操作的取消机制

**优先级理由**：改善用户体验，但影响范围有限。

---

#### 6. Settings 验证增强

**文件**：`packages/backend/src/settings/settings.service.ts:227`
**代码**：

```typescript
// TODO: 可能需要进一步验证 sequence 中的 id 和 shortcuts 中的 key 是否有效
```

**问题描述**：设置服务缺少对 sequence 和 shortcuts 的深度验证。

**建议方案**：

- 验证 sequence 中的 id 是否存在于 shortcuts 中
- 检查快捷键格式的合法性（键名、修饰符等）
- 添加循环引用检测

**优先级理由**：提升数据一致性，防止配置错误。

---

### 🟢 低优先级（2个）

#### 7. Passkey 实现说明

**文件**：`packages/backend/src/passkey/passkey.service.ts:299`
**代码**：

```typescript
// This aligns with the original code's approach and TODO comment.
```

**问题描述**：这是一个说明性注释，提醒当前实现与原有代码的 TODO 保持一致。

**建议方案**：

- 无需立即处理，仅作为代码历史记录
- 如有优化需求可统一重构 Passkey 验证逻辑

**优先级理由**：非功能性问题，无实际影响。

---

## 二、Frontend 模块技术债务

### 🔴 高优先级（4个）

#### 8. 错误通知显示缺失（9处）

**文件**：

- `packages/frontend/src/views/WorkspaceView.vue:804,814,823`
- `packages/frontend/src/stores/session/actions/sessionActions.ts:65`
- `packages/frontend/src/components/FileManager.vue:1118,1133,2011`

**代码**：

```typescript
// TODO: Show error notification
// TODO: 向用户显示错误
// TODO: Show error notification to user
```

**问题描述**：多个关键操作失败时没有向用户显示错误通知，用户无法感知操作结果。

**建议方案**：

- 统一使用 `ElMessage.error()` 或 `ElNotification.error()` 显示错误
- 集成 i18n 错误消息
- 添加错误重试机制

**优先级理由**：严重影响用户体验，用户无法得知操作失败。

---

### 🟡 中优先级（6个）

#### 9. TypeScript 类型定义不完善（3处）

**文件**：

- `packages/frontend/src/stores/favoritePaths.store.ts:5`
- `packages/frontend/src/stores/auth.store.ts:61`
- `packages/frontend/src/stores/appearance.store.ts:530`

**代码**：

```typescript
// TODO: Define these types more precisely based on API response
entries: any[]; // TODO: Define a proper type for blacklist entries
// TODO: 需要一种可靠的方式获取默认主题的数字 ID
```

**问题描述**：部分 Store 使用 `any` 类型或缺少精确的类型定义。

**建议方案**：

- 根据后端 API 响应定义完整的 TypeScript 接口
- 生成 API 类型定义（可使用 openapi-typescript）
- 移除所有 `any` 类型，提升类型安全

**优先级理由**：影响代码可维护性和 IDE 提示。

---

#### 10. 未授权处理缺失

**文件**：`packages/frontend/src/stores/proxies.store.ts:43`
**代码**：

```typescript
// TODO: 处理未授权情况
```

**问题描述**：代理 Store 缺少 401 未授权的处理逻辑。

**建议方案**：

- 在 Axios 拦截器中统一处理 401 响应
- 自动跳转到登录页
- 清理本地会话状态

**优先级理由**：影响安全性和用户体验。

---

#### 11. 编辑器保存提示

**文件**：`packages/frontend/src/stores/session/actions/editorActions.ts:121`
**代码**：

```typescript
// TODO: 检查 isDirty 状态，提示保存？
```

**问题描述**：关闭编辑器前没有检查未保存状态并提示用户。

**建议方案**：

- 检查 Monaco Editor 的 `isDirty` 状态
- 使用 `ElMessageBox.confirm()` 提示用户保存
- 提供"保存并关闭"、"丢弃更改"、"取消"三个选项

**优先级理由**：防止用户误操作导致数据丢失。

---

#### 12. 布局验证

**文件**：`packages/frontend/src/stores/layout.store.ts:406`
**代码**：

```typescript
// TODO: Add validation
```

**问题描述**：布局配置缺少验证逻辑，可能导致非法配置。

**建议方案**：

- 使用 Zod 定义布局配置 schema
- 验证面板尺寸、位置、类型等参数
- 提供默认值和边界检查

**优先级理由**：提升配置健壮性。

---

#### 13. 默认主题识别

**文件**：`packages/frontend/src/stores/appearance.store.ts:97,530`
**代码**：

```typescript
// TODO: 需要确认默认主题的识别方式 (preset_key='default' 或 name='默认')
// TODO: 需要一种可靠的方式获取默认主题的数字 ID
```

**问题描述**：默认主题的识别方式不统一，可能导致逻辑混乱。

**建议方案**：

- 在后端 API 中明确标记默认主题（添加 `is_default` 字段）
- 前端通过该字段识别默认主题
- 避免依赖 preset_key 或 name 字符串匹配

**优先级理由**：影响主题管理的可靠性。

---

### 🟢 低优先级（3个）

#### 14. 通知设置保存逻辑

**文件**：`packages/frontend/src/components/NotificationSettings.vue:197`
**代码**：

```typescript
// TODO: Implement save logic when form component is ready
```

**问题描述**：通知设置组件的保存逻辑待实现。

**建议方案**：

- 实现表单验证和提交逻辑
- 调用后端 API 保存配置
- 显示保存成功提示

**优先级理由**：功能尚未完成，但影响范围有限。

---

#### 15. 文件管理器错误状态

**文件**：`packages/frontend/src/components/FileManager.vue:1440`
**代码**：

```typescript
// TODO: 可以考虑通过 manager instance 暴露错误状态
```

**问题描述**：文件管理器实例没有暴露错误状态供外部访问。

**建议方案**：

- 在 FileManager 实例中添加 `lastError` 或 `errorState` 属性
- 提供 `clearError()` 方法
- 支持错误事件订阅

**优先级理由**：增强功能，但非必需。

---

#### 16. 快捷指令功能注释

**文件**：`packages/frontend/src/views/QuickCommandsView.vue:876-877`
**代码**：

```typescript
// Remove TODO and temporary warning/refresh
// console.warn("TODO: Implement assignCommandsToTagAction in quickCommands.store and backend");
```

**问题描述**：已注释的代码和警告，可能是旧版本的遗留。

**建议方案**：

- 确认该功能是否已实现
- 如已实现，删除注释代码
- 如未实现，转为正式的 GitHub Issue

**优先级理由**：代码清理项，无实际影响。

---

## 三、统计汇总

### 按严重程度统计

| 优先级   | Backend | Frontend | 合计   |
| -------- | ------- | -------- | ------ |
| 🔴 高    | 3       | 4        | **7**  |
| 🟡 中    | 6       | 6        | **12** |
| 🟢 低    | 2       | 3        | **5**  |
| **总计** | **11**  | **13**   | **24** |

### 按问题类型统计

| 类型                | 数量 |
| ------------------- | ---- |
| 🚨 错误处理缺失     | 10   |
| 🔒 安全/验证不完善  | 3    |
| 📝 类型定义不精确   | 3    |
| 🌐 国际化支持不完整 | 1    |
| 💾 持久化逻辑缺失   | 3    |
| 🎨 UI/UX 改进       | 2    |
| 🧹 代码清理         | 2    |

### 按模块统计

| 模块              | TODO 数量 |
| ----------------- | --------- |
| ssh-suspend       | 3         |
| transfers         | 2         |
| notifications     | 2         |
| connections       | 1         |
| settings          | 1         |
| passkey           | 1         |
| **Backend 小计**  | **10**    |
| WorkspaceView     | 3         |
| FileManager       | 4         |
| stores (多个)     | 6         |
| **Frontend 小计** | **13**    |

---

## 四、建议处理顺序

### 第一批（高优先级 - 1-2 周内完成）

1. **错误通知显示**（9处） - 影响用户体验
   - 工作量：1-2 天
   - 负责模块：Frontend

2. **Payload 验证**（transfers.controller） - 安全风险
   - 工作量：1 天
   - 负责模块：Backend

3. **用户语言偏好**（notifications） - 国际化基础
   - 工作量：2 天
   - 负责模块：Backend

4. **审计日志类型**（connections） - 合规需求
   - 工作量：0.5 天
   - 负责模块：Backend

### 第二批（中优先级 - 1 个月内完成）

5. **TypeScript 类型定义**（3处） - 代码质量
   - 工作量：2-3 天
   - 负责模块：Frontend

6. **SSH 会话持久化**（3处） - 功能增强
   - 工作量：3-4 天
   - 负责模块：Backend

7. **未授权处理**（proxies.store） - 安全性
   - 工作量：1 天
   - 负责模块：Frontend

8. **编辑器保存提示** - 防误操作
   - 工作量：1 天
   - 负责模块：Frontend

9. **默认主题识别** - 逻辑统一
   - 工作量：1 天
   - 负责模块：Frontend + Backend

### 第三批（低优先级 - 可延后）

10. **代码清理和优化** - 技术债务减少
    - 工作量：1-2 天
    - 负责模块：Backend + Frontend

---

## 五、转换为 GitHub Issues 建议

### Issue 模板示例

#### Issue #1: 【Frontend】统一添加错误通知显示

```markdown
**标签**：`enhancement`, `frontend`, `ux`, `priority:high`

**描述**：
多个关键操作失败时没有向用户显示错误通知，导致用户无法感知操作结果。

**影响范围**：

- WorkspaceView.vue (3处)
- sessionActions.ts (1处)
- FileManager.vue (3处)

**解决方案**：

- [ ] 统一使用 ElMessage.error() 或 ElNotification.error()
- [ ] 集成 i18n 错误消息
- [ ] 添加错误日志记录
- [ ] 考虑添加错误重试机制

**优先级**：高
**预估工作量**：1-2 天
```

#### Issue #2: 【Backend】transfers.controller 添加 payload 验证

```markdown
**标签**：`security`, `backend`, `priority:high`

**描述**：
文件传输控制器缺少请求 payload 的验证逻辑，存在潜在的安全风险。

**位置**：
`packages/backend/src/transfers/transfers.controller.ts:28`

**解决方案**：

- [ ] 使用 Zod 或 Joi 添加请求体 schema 验证
- [ ] 验证文件路径、大小、类型等参数
- [ ] 集成到现有的中间件链中
- [ ] 添加单元测试

**优先级**：高
**预估工作量**：1 天
```

---

## 六、维护建议

### 1. 代码审查规范

- **禁止新增 TODO**：所有新功能必须完整实现，不允许遗留 TODO
- **PR 检查**：Pre-commit hook 检测 TODO 数量，增加时给出警告
- **定期审查**：每月审查技术债务列表，及时清理

### 2. ESLint 规则配置

```javascript
// .eslintrc.js
module.exports = {
  rules: {
    'no-warning-comments': [
      'warn',
      {
        terms: ['TODO', 'FIXME', 'HACK', 'XXX'],
        location: 'start',
      },
    ],
  },
};
```

### 3. Git Hook 配置

```bash
# .husky/pre-commit
#!/bin/sh
TODO_COUNT=$(git diff --cached | grep -c "^\+.*TODO\|FIXME\|HACK")
if [ "$TODO_COUNT" -gt 0 ]; then
  echo "⚠️  警告：本次提交新增了 $TODO_COUNT 个 TODO 标记"
  echo "建议：创建 GitHub Issue 跟踪这些任务"
fi
```

---

## 七、结论

> ✅ **2025-12-24 更新**：所有技术债务已全部修复完成！

~~当前代码库的技术债务处于**可控状态**，大部分标记是功能增强和代码优化项，真正的高优先级问题有 7 个。~~

**修复成果**：

- ✅ 所有 24 个技术债务标记已全部清理
- ✅ 高优先级 7 个：100% 完成
- ✅ 中优先级 12 个：100% 完成
- ✅ 低优先级 5 个：100% 完成

**主要修复内容**：

1. **错误通知显示** (9处) - 统一使用 ElMessage.error() 显示错误
2. **Payload 验证** - 使用 Zod 添加请求体验证
3. **审计日志类型** - 定义 CONNECTIONS_TAG_ADDED 类型
4. **用户语言偏好** - 从数据库动态获取用户语言设置
5. **TypeScript 类型** - 定义精确的接口类型替换 any
6. **SSH 会话持久化** - 实现元数据持久化和服务重启恢复
7. **编辑器保存提示** - 添加未保存检测和确认对话框
8. **布局配置验证** - 使用 Zod 添加完整验证逻辑
9. **默认主题识别** - 统一使用 is_default_theme 字段
10. **代码注释清理** - 删除废弃注释，优化说明性注释

**关键指标**：

- ~~当前 TODO 总数：**24 个**~~
- ✅ 当前 TODO 总数：**0 个**
- ~~高优先级：**7 个**（需在 2 周内处理）~~
- ✅ 高优先级：**0 个**（全部已修复）
- ~~预估总工作量：**约 15-20 人天**~~
- ✅ 实际工作量：**约 2-3 人天**（AI 辅助开发）

---

**文档生成时间**：2025-12-23
**修复完成时间**：2025-12-24
**负责人**：哈雷酱 (本小姐！)
**状态**：✅ 全部修复完成
