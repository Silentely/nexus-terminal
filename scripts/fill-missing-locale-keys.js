#!/usr/bin/env node
/**
 * 补齐前端语言包中缺失的 i18n key
 * 数据来源：各 View/Component/Store 中带 fallback 的 t('key', 'fallback') 调用，
 * 这些调用此前因 key 缺失而始终显示 fallback（多为中文），导致英文/日文用户看到中文。
 */
const fs = require('fs');

// 缺失 key 清单：key -> { zh, en, ja }
const MISSING = {
  'connections.batchEdit.noSelectionForEdit': {
    zh: '请至少选择一个连接进行编辑。',
    en: 'Please select at least one connection to edit.',
    ja: '編集する接続を少なくとも 1 つ選択してください。',
  },
  'connections.test.unknownError': {
    zh: '未知错误',
    en: 'Unknown error',
    ja: '不明なエラー',
  },
  'connections.test.unknownErrorDuringBatch': {
    zh: '批量测试中发生错误',
    en: 'An error occurred during batch testing',
    ja: '一括テスト中にエラーが発生しました',
  },
  'connections.test.onlySshSupportedTest': {
    zh: '仅SSH连接支持测试。',
    en: 'Only SSH connections support testing.',
    ja: 'テストをサポートしているのは SSH 接続のみです。',
  },
  'connections.messages.noSshConnectionsToConnectAll': {
    zh: '没有可连接的 SSH 筛选结果。',
    en: 'No SSH connections match the current filter.',
    ja: '現在のフィルターに一致する SSH 接続がありません。',
  },
  'connections.errors.connectAllSshFailed': {
    zh: '连接全部 SSH 操作失败。',
    en: 'Failed to connect to all SSH connections.',
    ja: 'すべての SSH 接続に失敗しました。',
  },
  'connections.unnamedFallback': {
    zh: '未命名连接',
    en: 'Unnamed connection',
    ja: '名前のない接続',
  },
  'connections.form.typeTelnet': {
    zh: 'Telnet',
    en: 'Telnet',
    ja: 'Telnet',
  },
  'connections.batchEdit.noConnectionsToUpdate': {
    zh: '没有选中的连接可供更新',
    en: 'No connections selected for update',
    ja: '更新する接続が選択されていません',
  },
  'connections.batchEdit.noChanges': {
    zh: '未检测到任何更改',
    en: 'No changes detected',
    ja: '変更は検出されませんでした',
  },
  'quickCommands.noResults': {
    zh: '没有找到匹配的指令',
    en: 'No matching commands found',
    ja: '一致するコマンドが見つかりません',
  },
  'quickCommands.sortByLastUsed': {
    zh: '按最近使用排序',
    en: 'Sort by last used',
    ja: '最近使用した順に並べ替え',
  },
  'quickCommands.title': {
    zh: '快捷指令',
    en: 'Quick Commands',
    ja: 'クイックコマンド',
  },
  'settings.tabs.ai': {
    zh: 'AI 助手',
    en: 'AI Assistant',
    ja: 'AI アシスタント',
  },
  'workspace.noActiveSession': {
    zh: '没有活动的会话',
    en: 'No active session',
    ja: 'アクティブなセッションがありません',
  },
  'suspendedSshSessions.title': {
    zh: '挂起会话',
    en: 'Suspended Sessions',
    ja: '一時停止中のセッション',
  },
  'commandInputBar.hideKeyboard': {
    zh: '隐藏虚拟键盘',
    en: 'Hide virtual keyboard',
    ja: '仮想キーボードを隠す',
  },
  'commandInputBar.showKeyboard': {
    zh: '显示虚拟键盘',
    en: 'Show virtual keyboard',
    ja: '仮想キーボードを表示',
  },
  'favoritePaths.sendToTerminal': {
    zh: '发送到终端',
    en: 'Send to Terminal',
    ja: 'ターミナルに送信',
  },
  'favoritePaths.title': {
    zh: '收藏路径',
    en: 'Favorite Paths',
    ja: 'お気に入りパス',
  },
  'favoritePaths.notifications.markAsUsedError': {
    zh: '标记路径为已使用失败',
    en: 'Failed to mark path as used',
    ja: 'パスを使用済みとしてマークできませんでした',
  },
  'fileManager.actions.search': {
    zh: '搜索',
    en: 'Search',
    ja: '検索',
  },
  'fileManager.actions.exitMultiSelect': {
    zh: '退出多选模式',
    en: 'Exit Multi-Select Mode',
    ja: '複数選択モードを終了',
  },
  'fileManager.actions.multiSelect': {
    zh: '进入多选模式',
    en: 'Enter Multi-Select Mode',
    ja: '複数選択モードを開始',
  },
  'layout.noSshSessionActive.title': {
    zh: '无活动的 SSH 会话',
    en: 'No active SSH session',
    ja: 'アクティブな SSH セッションがありません',
  },
  'layout.noSshSessionActive.message': {
    zh: '请激活一个 SSH 会话以使用此终端面板。',
    en: 'Please activate an SSH session to use this terminal panel.',
    ja: 'このターミナルパネルを使用するには SSH セッションをアクティブにしてください。',
  },
  'sendFilesModal.errorSourceConnectionMissing': {
    zh: '源服务器信息缺失，无法发起传输。',
    en: 'Source server information is missing. Cannot initiate transfer.',
    ja: '送信元サーバー情報がありません。転送を開始できません。',
  },
  'statusMonitor.routePlan': {
    zh: '路由路径',
    en: 'Route Path',
    ja: 'ルートパス',
  },
  'statusMonitor.copyIpError': {
    zh: '复制 IP 失败',
    en: 'Failed to copy IP',
    ja: 'IP のコピーに失敗しました',
  },
  'commandPalette.placeholder': {
    zh: '输入命令或搜索...',
    en: 'Type a command or search...',
    ja: 'コマンドを入力するか検索...',
  },
  'commandPalette.noResults': {
    zh: '未找到匹配的命令',
    en: 'No matching commands found',
    ja: '一致するコマンドが見つかりません',
  },
  'commandPalette.actionFailed': {
    zh: '执行失败，请稍后重试',
    en: 'Action failed, please try again later',
    ja: '実行に失敗しました。後でもう一度お試しください',
  },
  'settings.captcha.secretKeyEmptyHint': {
    zh: '留空则保留原有密钥，如需清除请填写新值后保存。',
    en: 'Leave empty to keep the existing secret. To clear it, enter a new value and save.',
    ja: '空のままにすると既存のシークレットが保持されます。クリアするには新しい値を入力して保存してください。',
  },
  'settings.dataManagement.dockerMigrationHint.title': {
    zh: '服务器间迁移推荐方式',
    en: 'Recommended way to migrate between servers',
    ja: 'サーバー間移行の推奨方法',
  },
  'settings.dataManagement.dockerMigrationHint.description': {
    zh: '如需在服务器间完整迁移，最简单的方式是直接复制宿主机的 ./data 目录及 data/.env 文件到新服务器，然后启动 Docker 容器即可。',
    en: 'For a complete migration between servers, the simplest approach is to copy the ./data directory and the data/.env file from the host to the new server, then start the Docker containers.',
    ja: 'サーバー間で完全に移行するには、ホストの ./data ディレクトリと data/.env ファイルを新しいサーバーにコピーし、Docker コンテナを起動するのが最も簡単です。',
  },
  'settings.exportConnections.cliHint': {
    zh: '导出为 CLI 脚本格式（ZIP），用于在其他 Nexus Terminal 实例中通过命令行导入。',
    en: 'Export as CLI script format (ZIP) for importing via command line in another Nexus Terminal instance.',
    ja: '別の Nexus Terminal インスタンスでコマンドラインからインポートするための CLI スクリプト形式（ZIP）としてエクスポートします。',
  },
  'settings.exportConnections.proxyNote': {
    zh: '注意：代理配置和按内容存储的 SSH 密钥不包含在导出中。',
    en: 'Note: proxy configurations and content-stored SSH keys are not included in the export.',
    ja: '注意: プロキシ設定とコンテンツ保存の SSH キーはエクスポートに含まれません。',
  },
  'settings.exportConnections.passwordLabel': {
    zh: '导出密码（可选）',
    en: 'Export password (optional)',
    ja: 'エクスポートパスワード（任意）',
  },
  'settings.exportConnections.passwordPlaceholder': {
    zh: '留空则使用 ENCRYPTION_KEY',
    en: 'Leave empty to use ENCRYPTION_KEY',
    ja: '空の場合は ENCRYPTION_KEY を使用',
  },
  'settings.fullBackupExport.title': {
    zh: '完整数据备份',
    en: 'Full Data Backup',
    ja: '完全データバックアップ',
  },
  'settings.fullBackupExport.description': {
    zh: '导出全部核心业务数据为 JSON 文件，包含连接、标签、快捷指令、终端主题等。可用于跨实例完整恢复。',
    en: 'Export all core business data as a JSON file, including connections, tags, quick commands, terminal themes, and more. Can be used for full cross-instance recovery.',
    ja: '接続、タグ、クイックコマンド、ターミナルテーマなどを含むすべてのコアデータを JSON ファイルとしてエクスポートします。インスタンス間の完全復元に使用できます。',
  },
  'settings.fullBackupExport.encryptionKeyWarning': {
    zh: '恢复时需使用与导出相同的 ENCRYPTION_KEY，否则连接密码和 SSH 密钥将无法解密。',
    en: 'Restoration requires the same ENCRYPTION_KEY used for the export; otherwise connection passwords and SSH keys cannot be decrypted.',
    ja: '復元にはエクスポート時と同じ ENCRYPTION_KEY が必要です。そうしないと接続パスワードと SSH キーを復号できません。',
  },
  'settings.fullBackupExport.buttonText': {
    zh: '导出备份文件',
    en: 'Export backup file',
    ja: 'バックアップファイルをエクスポート',
  },
  'settings.fullBackupExport.success': {
    zh: '备份文件已开始下载。',
    en: 'Backup file download started.',
    ja: 'バックアップファイルのダウンロードを開始しました。',
  },
  'settings.fullBackupExport.error': {
    zh: '导出备份时发生错误。',
    en: 'An error occurred while exporting the backup.',
    ja: 'バックアップのエクスポート中にエラーが発生しました。',
  },
  'settings.importConnections.title': {
    zh: '导入连接数据',
    en: 'Import Connection Data',
    ja: '接続データをインポート',
  },
  'settings.importConnections.description': {
    zh: '选择 JSON 格式的连接配置文件进行导入（仅支持连接数据，不含标签、主题等）。文件大小限制 5MB。',
    en: 'Select a JSON connection config file to import (connection data only; tags, themes, etc. are not included). File size limit: 5MB.',
    ja: 'JSON 形式の接続設定ファイルを選択してインポートします（接続データのみ。タグやテーマなどは含まれません）。ファイルサイズ上限: 5MB。',
  },
  'settings.importConnections.confirmText': {
    zh: '导入将覆盖当前设置，是否继续？',
    en: 'Importing will overwrite current settings. Continue?',
    ja: 'インポートすると現在の設定が上書きされます。続行しますか？',
  },
  'settings.importConnections.confirmButton': {
    zh: '确认导入',
    en: 'Confirm Import',
    ja: 'インポートを確認',
  },
  'settings.importConnections.buttonText': {
    zh: '选择文件导入',
    en: 'Select file to import',
    ja: 'インポートするファイルを選択',
  },
  'settings.importConnections.errorDetails': {
    zh: '导入错误详情',
    en: 'Import error details',
    ja: 'インポートエラーの詳細',
  },
  'settings.importConnections.invalidFileType': {
    zh: '请选择 JSON 格式的文件。',
    en: 'Please select a JSON file.',
    ja: 'JSON 形式のファイルを選択してください。',
  },
  'settings.importConnections.fileTooLarge': {
    zh: '文件大小超过 5MB 限制。',
    en: 'File size exceeds the 5MB limit.',
    ja: 'ファイルサイズが 5MB の制限を超えています。',
  },
  'settings.ipBlacklist.disabledMessage': {
    zh: 'IP 黑名单功能当前已禁用。',
    en: 'IP blacklist feature is currently disabled.',
    ja: 'IP ブラックリスト機能は現在無効です。',
  },
  'settings.passkey.enterNamePlaceholder': {
    zh: '输入 Passkey 名称',
    en: 'Enter Passkey name',
    ja: 'Passkey 名を入力',
  },
  'settings.passkey.editNameTooltip': {
    zh: '编辑名称',
    en: 'Edit name',
    ja: '名前を編集',
  },
  'common.deleting': {
    zh: '删除中...',
    en: 'Deleting...',
    ja: '削除中...',
  },
  'common.unknownError': {
    zh: '未知错误',
    en: 'Unknown error',
    ja: '不明なエラー',
  },
  // --- 第二轮补充（features/composables 中发现的缺失 key）---
  'common.copy': {
    zh: '复制',
    en: 'Copy',
    ja: 'コピー',
  },
  'common.paste': {
    zh: '粘贴',
    en: 'Paste',
    ja: '貼り付け',
  },
  'common.dismiss': {
    zh: '关闭',
    en: 'Dismiss',
    ja: '閉じる',
  },
  'common.confirmationTitle': {
    zh: '请确认',
    en: 'Please confirm',
    ja: '確認してください',
  },
  'errors.unknown': {
    zh: '未知错误',
    en: 'Unknown error',
    ja: '不明なエラー',
  },
  'batchOps.copyOutput': {
    zh: '复制到剪贴板',
    en: 'Copy to clipboard',
    ja: 'クリップボードにコピー',
  },
  'batchOps.sudoConfirm': {
    zh: '警告：将以 sudo 权限运行。是否继续？',
    en: 'Warning: Running with sudo privileges. Continue?',
    ja: '警告: sudo 権限で実行します。続行しますか？',
  },
  'settings.exportConnections.error': {
    zh: '导出连接时发生错误。',
    en: 'An error occurred while exporting connections.',
    ja: '接続のエクスポート中にエラーが発生しました。',
  },
  'settings.exportConnections.success': {
    zh: '导出成功。文件已开始下载。',
    en: 'Export successful. The file download has started.',
    ja: 'エクスポートに成功しました。ファイルのダウンロードが開始されました。',
  },
  'settings.importConnections.error': {
    zh: '导入连接时发生错误。',
    en: 'An error occurred while importing connections.',
    ja: '接続のインポート中にエラーが発生しました。',
  },
  'settings.ipBlacklist.error.updateFailed': {
    zh: '更新 IP 黑名单启用状态失败',
    en: 'Failed to update IP blacklist enabled state',
    ja: 'IP ブラックリストの有効状態の更新に失敗しました',
  },
  'settings.passkey.error.deleteFailedInvalidId': {
    zh: '删除失败：无效的凭证 ID。',
    en: 'Deletion failed: invalid credential ID.',
    ja: '削除に失敗しました: 無効な資格情報 ID です。',
  },
  'settings.passkey.error.nameUpdateFailed': {
    zh: '更新 Passkey 名称失败。',
    en: 'Failed to update Passkey name.',
    ja: 'Passkey 名の更新に失敗しました。',
  },
  'settings.statusMonitorShowIp.error.saveFailed': {
    zh: '保存状态监控 IP 显示设置失败。',
    en: 'Failed to save status monitor IP display setting.',
    ja: 'ステータスモニターの IP 表示設定の保存に失敗しました。',
  },
  // --- 第三轮补充（代码引用守卫测试发现的缺失 key + 审查发现的预存中文值）---
  'tags.createFailed': {
    zh: '创建标签失败: {error}',
    en: 'Failed to create tag: {error}',
    ja: 'タグの作成に失敗しました: {error}',
  },
  'tags.deleteSuccessWithName': {
    zh: '标签 "{name}" 删除成功。',
    en: 'Tag "{name}" deleted successfully.',
    ja: 'タグ "{name}" を削除しました。',
  },
  'tags.deleteFailedWithName': {
    zh: '标签 "{name}" 删除失败: {error}',
    en: 'Failed to delete tag "{name}": {error}',
    ja: 'タグ "{name}" の削除に失敗しました: {error}',
  },
  'sshKeys.selector.errorLoading': {
    zh: '加载 SSH 密钥失败: {error}',
    en: 'Failed to load SSH keys: {error}',
    ja: 'SSH キーの読み込みに失敗しました: {error}',
  },
  'statusMonitor.hops': {
    zh: '跳',
    en: 'hops',
    ja: 'ホップ',
  },
  'term.unknownError': {
    zh: '未知错误',
    en: 'Unknown error',
    ja: '不明なエラー',
  },
  'term.sshSuspend': {
    zh: 'SSH 挂起',
    en: 'SSH Suspend',
    ja: 'SSH 一時停止',
  },
  'common.navigate': {
    zh: '导航',
    en: 'Navigate',
    ja: '移動',
  },
  'common.select': {
    zh: '选择',
    en: 'Select',
    ja: '選択',
  },
  'common.selectAll': {
    zh: '全选',
    en: 'Select all',
    ja: 'すべて選択',
  },
  'common.deselectAll': {
    zh: '取消全选',
    en: 'Deselect all',
    ja: 'すべて選択解除',
  },
  'common.unexpectedError': {
    zh: '发生意外错误，请稍后重试',
    en: 'An unexpected error occurred, please try again later',
    ja: '予期しないエラーが発生しました。後でもう一度お試しください',
  },
  'styleCustomizer.customHtmlResetFailed': {
    zh: '重置自定义 HTML 失败: {message}',
    en: 'Failed to reset custom HTML: {message}',
    ja: 'カスタム HTML のリセットに失敗しました: {message}',
  },
  'styleCustomizer.errorFetchingPresetContentForCopy': {
    zh: '获取预设内容用于复制失败: {message}',
    en: 'Failed to fetch preset content for copying: {message}',
    ja: 'コピー用のプリセット内容の取得に失敗しました: {message}',
  },
  'styleCustomizer.uiThemeSaved': {
    zh: 'UI 主题已保存。',
    en: 'UI theme saved.',
    ja: 'UI テーマを保存しました。',
  },
  'settings.changePassword.error.fieldsRequired': {
    zh: '请输入当前密码和新密码。',
    en: 'Please enter the current password and a new password.',
    ja: '現在のパスワードと新しいパスワードを入力してください。',
  },
  'settings.importConnections.partialSuccess': {
    zh: '导入完成，成功 {success} 条，失败 {failure} 条。',
    en: 'Import finished: {success} succeeded, {failure} failed.',
    ja: 'インポートが完了しました: 成功 {success} 件、失敗 {failure} 件。',
  },
  'settings.importConnections.success': {
    zh: '导入成功完成。共导入 {count} 条连接。',
    en: 'Import completed successfully. {count} connections imported.',
    ja: 'インポートに成功しました。{count} 件の接続をインポートしました。',
  },
  'settings.passkey.error.registrationCancelledOrExists': {
    zh: 'Passkey 注册已取消或已存在。',
    en: 'Passkey registration was cancelled or already exists.',
    ja: 'Passkey の登録がキャンセルされたか、すでに存在します。',
  },
  'connections.form.scriptErrorMissingPasswordForTelnet': {
    zh: '连接 "{host}" 缺少 Telnet 密码。',
    en: 'Missing Telnet password for connection "{host}".',
    ja: '接続 "{host}" の Telnet パスワードがありません。',
  },
  'proxies.errors.notFound': {
    zh: '找不到代理 "{name}"。',
    en: 'Proxy "{name}" not found.',
    ja: 'プロキシ "{name}" が見つかりません。',
  },
  'connections.form.errorDelete': {
    zh: '删除连接失败: {error}',
    en: 'Failed to delete connection: {error}',
    ja: '接続の削除に失敗しました: {error}',
  },
  'fileManager.errors.uploadFailed': {
    zh: '上传失败',
    en: 'Upload failed',
    ja: 'アップロードに失敗しました',
  },
  'fileManager.errors.readFileTimeout': {
    zh: '读取文件超时',
    en: 'Timed out reading the file',
    ja: 'ファイルの読み取りがタイムアウトしました',
  },
  'fileManager.errors.sessionInvalidOrNotReady': {
    zh: '会话无效或未就绪，保存失败',
    en: 'Session is invalid or not ready. Save failed.',
    ja: 'セッションが無効または準備ができていません。保存に失敗しました。',
  },
  'quickCommands.tags.createSuccess': {
    zh: '标签创建成功。',
    en: 'Tag created successfully.',
    ja: 'タグを作成しました。',
  },
  'quickCommands.tags.noCommandsToAssign': {
    zh: '没有可分配标签的指令。',
    en: 'No commands available to assign tags.',
    ja: 'タグを割り当てられるコマンドがありません。',
  },
  'workspace.terminal.unknownReason': {
    zh: '未知原因',
    en: 'Unknown reason',
    ja: '不明な理由',
  },
  'workspace.terminal.unknownSshError': {
    zh: '未知的 SSH 错误',
    en: 'Unknown SSH error',
    ja: '不明な SSH エラー',
  },
  'workspace.terminal.unknownGenericError': {
    zh: '未知的通用错误',
    en: 'Unknown generic error',
    ja: '不明な汎用エラー',
  },
  'workspaceConnectionList.allConnectionsTaggedFailed': {
    zh: '为所有连接添加标签失败',
    en: 'Failed to tag all connections',
    ja: 'すべての接続へのタグ付けに失敗しました',
  },
  'terminal.output': {
    zh: '终端输出',
    en: 'Terminal output',
    ja: 'ターミナル出力',
  },
  'dashboard.errors.refreshFailed': {
    zh: '刷新数据失败，请稍后重试',
    en: 'Failed to refresh data, please try again later',
    ja: 'データの更新に失敗しました。後でもう一度お試しください',
  },
  'dashboard.errors.timeRangeFailed': {
    zh: '时间范围变更失败，请稍后重试',
    en: 'Failed to change time range, please try again later',
    ja: '時間範囲の変更に失敗しました。後でもう一度お試しください',
  },
  'dashboard.errors.initFailed': {
    zh: '仪表盘初始化失败，请刷新页面重试',
    en: 'Dashboard initialization failed, please refresh the page',
    ja: 'ダッシュボードの初期化に失敗しました。ページを再読み込みしてください',
  },
  'dashboard.errors.connectFailed': {
    zh: '连接失败，请稍后重试',
    en: 'Connection failed, please try again later',
    ja: '接続に失敗しました。後でもう一度お試しください',
  },
  'dashboard.errors.connectionsFailed': {
    zh: '连接列表更新失败，请稍后重试',
    en: 'Failed to update the connection list, please try again later',
    ja: '接続リストの更新に失敗しました。後でもう一度お試しください',
  },
  // 审查发现的预存中文值（en/ja 中仍为中文）
  'settings.exportConnections.buttonText': {
    zh: '开始导出',
    en: 'Start Export',
    ja: 'エクスポートを開始',
  },
  'settings.tabs.about': {
    zh: '关于',
    en: 'About',
    ja: 'このアプリについて',
  },
  // --- 第四轮补充（en-US 中残留中文的 batchOps/aiOps 等模块）---
  'styleCustomizer.localPresetRenamed': {
    zh: '本地预设 "{oldName}" 已成功重命名为 "{newName}"。',
    en: 'Local preset "{oldName}" renamed to "{newName}".',
    ja: 'ローカルプリセット "{oldName}" を "{newName}" に名前変更しました。',
  },
  'styleCustomizer.localPresetRenameFailed': {
    zh: '重命名本地预设失败: {message}',
    en: 'Failed to rename local preset: {message}',
    ja: 'ローカルプリセットの名前変更に失敗しました: {message}',
  },
  'settings.notifications.events.CONNECTIONS_EXPORTED': {
    zh: '连接已导出',
    en: 'Connections Exported',
    ja: '接続をエクスポートしました',
  },
  'layoutConfigurator.confirmClose': {
    zh: '有未保存的更改，确定要关闭吗？',
    en: 'You have unsaved changes. Are you sure you want to close?',
    ja: '保存されていない変更があります。閉じてもよろしいですか？',
  },
  'layoutConfigurator.confirmReset': {
    zh: '确定要恢复默认布局和侧栏配置吗？当前更改将丢失。',
    en: 'Reset to default layout and sidebar configuration? Current changes will be lost.',
    ja: 'デフォルトレイアウトとサイドバー設定に戻しますか？現在の変更は失われます。',
  },
  'batchOps.title': {
    zh: '批量执行',
    en: 'Batch Execution',
    ja: '一括実行',
  },
  'batchOps.progress': {
    zh: '进度',
    en: 'Progress',
    ja: '進捗',
  },
  'batchOps.selectServers': {
    zh: '选择服务器',
    en: 'Select servers',
    ja: 'サーバーを選択',
  },
  'batchOps.noConnections': {
    zh: '没有可用的 SSH 连接',
    en: 'No SSH connections available',
    ja: '利用可能な SSH 接続がありません',
  },
  'batchOps.commandLabel': {
    zh: '要执行的命令',
    en: 'Command to execute',
    ja: '実行するコマンド',
  },
  'batchOps.commandPlaceholder': {
    zh: '例如 apt-get update',
    en: 'e.g. apt-get update',
    ja: '例: apt-get update',
  },
  'batchOps.execute': {
    zh: '广播执行',
    en: 'Execute on all',
    ja: 'すべてに実行',
  },
  'batchOps.cancel': {
    zh: '取消',
    en: 'Cancel',
    ja: 'キャンセル',
  },
  'batchOps.sudo': {
    zh: '以 sudo 运行',
    en: 'Run with sudo',
    ja: 'sudo で実行',
  },
  'batchOps.concurrency': {
    zh: '并发数',
    en: 'Concurrency',
    ja: '同時実行数',
  },
  'batchOps.results': {
    zh: '执行结果',
    en: 'Results',
    ja: '実行結果',
  },
  'batchOps.viewOutput': {
    zh: '查看',
    en: 'View',
    ja: '表示',
  },
  'batchOps.output': {
    zh: '输出',
    en: 'Output',
    ja: '出力',
  },
  'batchOps.noOutput': {
    zh: '无输出',
    en: 'No output',
    ja: '出力なし',
  },
  'batchOps.status.queued': {
    zh: '队列中',
    en: 'Queued',
    ja: '待機中',
  },
  'batchOps.status.inProgress': {
    zh: '执行中',
    en: 'In progress',
    ja: '実行中',
  },
  'batchOps.status.partiallyCompleted': {
    zh: '部分完成',
    en: 'Partially completed',
    ja: '一部完了',
  },
  'batchOps.status.completed': {
    zh: '已完成',
    en: 'Completed',
    ja: '完了',
  },
  'batchOps.status.failed': {
    zh: '已失败',
    en: 'Failed',
    ja: '失敗',
  },
  'batchOps.status.cancelled': {
    zh: '已取消',
    en: 'Cancelled',
    ja: 'キャンセル済み',
  },
  'aiOps.title': {
    zh: 'AI 运维助手',
    en: 'AI Ops Assistant',
    ja: 'AI 運用アシスタント',
  },
  'aiOps.newSession': {
    zh: '新建会话',
    en: 'New session',
    ja: '新規セッション',
  },
  'aiOps.history': {
    zh: '历史记录',
    en: 'History',
    ja: '履歴',
  },
  'aiOps.sessionHistory': {
    zh: '会话历史',
    en: 'Session history',
    ja: 'セッション履歴',
  },
  'aiOps.noSessions': {
    zh: '暂无历史会话',
    en: 'No session history',
    ja: 'セッション履歴はありません',
  },
  'aiOps.untitled': {
    zh: '未命名会话',
    en: 'Untitled session',
    ja: '名前のないセッション',
  },
  'aiOps.placeholder': {
    zh: '询问关于服务器或日志的任何问题...',
    en: 'Ask anything about your servers or logs...',
    ja: 'サーバーやログについて何でも質問してください...',
  },
  'aiOps.typing': {
    zh: 'AI 正在分析...',
    en: 'AI is analyzing...',
    ja: 'AI が分析中...',
  },
  'aiOps.insights': {
    zh: '洞察',
    en: 'Insights',
    ja: 'インサイト',
  },
  'aiOps.inputPlaceholder': {
    zh: '输入消息...',
    en: 'Type a message...',
    ja: 'メッセージを入力...',
  },
  'aiOps.generateCommand': {
    zh: '生成命令',
    en: 'Generate command',
    ja: 'コマンドを生成',
  },
  'aiOps.disable': {
    zh: '禁用 AI',
    en: 'Disable AI',
    ja: 'AI を無効化',
  },
  'aiOps.enable': {
    zh: '启用 AI',
    en: 'Enable AI',
    ja: 'AI を有効化',
  },
  'aiOps.enableInSettings': {
    zh: '在设置中启用',
    en: 'Enable in settings',
    ja: '設定で有効化',
  },
  'aiOps.sendMessage': {
    zh: '发送消息',
    en: 'Send message',
    ja: 'メッセージを送信',
  },
  'aiOps.suggestions.health': {
    zh: '检查系统健康状态',
    en: 'Check system health',
    ja: 'システムのヘルス状態を確認',
  },
  'aiOps.suggestions.commands': {
    zh: '分析命令执行模式',
    en: 'Analyze command execution patterns',
    ja: 'コマンド実行パターンを分析',
  },
  'aiOps.suggestions.security': {
    zh: '查看安全事件统计',
    en: 'View security event statistics',
    ja: 'セキュリティイベント統計を表示',
  },
  'aiOps.suggestions.connections': {
    zh: '连接使用情况',
    en: 'Connection usage',
    ja: '接続使用状況',
  },
};

function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    // 防护原型污染：拒绝 __proto__ / constructor / prototype 链
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
    if (typeof cur[key] !== 'object' || cur[key] === null) cur[key] = {};
    cur = cur[key];
  }
  const lastKey = parts[parts.length - 1];
  if (lastKey === '__proto__' || lastKey === 'constructor' || lastKey === 'prototype') return;
  cur[lastKey] = value;
}

for (const lang of ['zh-CN', 'en-US', 'ja-JP']) {
  const file = `packages/frontend/src/locales/${lang}.json`;
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  let added = 0;
  for (const [key, texts] of Object.entries(MISSING)) {
    const langKey = lang === 'zh-CN' ? 'zh' : lang === 'en-US' ? 'en' : 'ja';
    setPath(obj, key, texts[langKey]);
    added++;
  }
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
  console.log(`${lang}: 已补充 ${added} 个 key`);
}
