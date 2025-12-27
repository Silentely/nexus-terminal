<template>
  <div
    v-if="settings"
    class="bg-background border border-border rounded-lg shadow-sm overflow-hidden"
  >
    <h2 class="text-lg font-semibold text-foreground px-6 py-4 border-b border-border bg-header/50">
      {{ $t('settings.workspace.title') }}
    </h2>
    <div class="p-6 space-y-6">
      <!-- Popup Editor -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ $t('settings.popupEditor.title') }}
        </h3>
        <form @submit.prevent="handleUpdatePopupEditorSetting" class="space-y-4">
          <div class="flex items-center">
            <input
              type="checkbox"
              id="showPopupEditor"
              v-model="popupEditorEnabled"
              class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
            />
            <label
              for="showPopupEditor"
              class="text-sm text-foreground cursor-pointer select-none"
              >{{ $t('settings.popupEditor.enableLabel') }}</label
            >
          </div>
          <div class="flex items-center justify-between">
            <button
              type="submit"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ $t('common.save') }}
            </button>
            <p
              v-if="popupEditorMessage"
              :class="['text-sm', popupEditorSuccess ? 'text-success' : 'text-error']"
            >
              {{ popupEditorMessage }}
            </p>
          </div>
        </form>
      </div>
      <hr class="border-border/50" />
      <!-- Popup File Manager -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ t('settings.popupFileManager.title') }}
        </h3>
        <form @submit.prevent="handleUpdateShowPopupFileManager" class="space-y-4">
          <div class="flex items-center">
            <input
              type="checkbox"
              id="showPopupFileManager"
              v-model="showPopupFileManagerLocal"
              class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
            />
            <label
              for="showPopupFileManager"
              class="text-sm text-foreground cursor-pointer select-none"
              >{{ t('settings.popupFileManager.enableLabel') }}</label
            >
          </div>
          <!-- <small class="block mt-1 text-xs text-text-secondary">{{ t('settings.popupFileManager.description') }}</small> -->
          <div class="flex items-center justify-between">
            <button
              type="submit"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ t('common.save') }}
            </button>
            <p
              v-if="showPopupFileManagerMessage"
              :class="['text-sm', showPopupFileManagerSuccess ? 'text-success' : 'text-error']"
            >
              {{ showPopupFileManagerMessage }}
            </p>
          </div>
        </form>
      </div>
      <hr class="border-border/50" />
      <!-- Share Tabs -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ $t('settings.shareEditorTabs.title') }}
        </h3>
        <form @submit.prevent="handleUpdateShareTabsSetting" class="space-y-4">
          <div class="flex items-center">
            <input
              type="checkbox"
              id="shareEditorTabs"
              v-model="shareTabsEnabled"
              class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
            />
            <label
              for="shareEditorTabs"
              class="text-sm text-foreground cursor-pointer select-none"
              >{{ $t('settings.shareEditorTabs.enableLabel') }}</label
            >
          </div>
          <p class="text-xs text-text-secondary mt-1">
            {{ $t('settings.shareEditorTabs.description') }}
          </p>
          <div class="flex items-center justify-between">
            <button
              type="submit"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ $t('common.save') }}
            </button>
            <p
              v-if="shareTabsMessage"
              :class="['text-sm', shareTabsSuccess ? 'text-success' : 'text-error']"
            >
              {{ shareTabsMessage }}
            </p>
          </div>
        </form>
      </div>
      <hr class="border-border/50" />
      <!-- Auto Copy -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ $t('settings.autoCopyOnSelect.title') }}
        </h3>
        <form @submit.prevent="handleUpdateAutoCopySetting" class="space-y-4">
          <div class="flex items-center">
            <input
              type="checkbox"
              id="autoCopyOnSelect"
              v-model="autoCopyEnabled"
              class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
            />
            <label
              for="autoCopyOnSelect"
              class="text-sm text-foreground cursor-pointer select-none"
              >{{ $t('settings.autoCopyOnSelect.enableLabel') }}</label
            >
          </div>
          <div class="flex items-center justify-between">
            <button
              type="submit"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ $t('common.save') }}
            </button>
            <p
              v-if="autoCopyMessage"
              :class="['text-sm', autoCopySuccess ? 'text-success' : 'text-error']"
            >
              {{ autoCopyMessage }}
            </p>
          </div>
        </form>
      </div>
      <hr class="border-border/50" />
      <!-- Persistent Sidebar -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ $t('settings.workspace.sidebarPersistentTitle') }}
        </h3>
        <form @submit.prevent="handleUpdateWorkspaceSidebarSetting" class="space-y-4">
          <div class="flex items-center">
            <input
              type="checkbox"
              id="workspaceSidebarPersistent"
              v-model="workspaceSidebarPersistentEnabled"
              class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
            />
            <label
              for="workspaceSidebarPersistent"
              class="text-sm text-foreground cursor-pointer select-none"
              >{{ $t('settings.workspace.sidebarPersistentLabel') }}</label
            >
          </div>
          <p class="text-xs text-text-secondary mt-1">
            {{ $t('settings.workspace.sidebarPersistentDescription') }}
          </p>
          <div class="flex items-center justify-between">
            <button
              type="submit"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ $t('common.save') }}
            </button>
            <p
              v-if="workspaceSidebarPersistentMessage"
              :class="[
                'text-sm',
                workspaceSidebarPersistentSuccess ? 'text-success' : 'text-error',
              ]"
            >
              {{ workspaceSidebarPersistentMessage }}
            </p>
          </div>
        </form>
      </div>
      <hr class="border-border/50" />
      <!-- Command Input Sync Target -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ $t('settings.commandInputSync.title', '命令输入同步') }}
        </h3>
        <form @submit.prevent="handleUpdateCommandInputSyncTarget" class="space-y-4">
          <div>
            <label
              for="commandInputSyncTargetSelect"
              class="block text-sm font-medium text-text-secondary mb-1"
              >{{ $t('settings.commandInputSync.selectLabel', '同步目标') }}</label
            >
            <select
              id="commandInputSyncTargetSelect"
              v-model="commandInputSyncTargetLocal"
              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8"
              style="
                background-image: url(&quot;data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M2 5l6 6 6-6'/%3e%3c/svg%3e&quot;);
                background-position: right 0.75rem center;
                background-size: 16px 12px;
              "
            >
              <option value="none">{{ $t('settings.commandInputSync.targetNone', '无') }}</option>
              <option value="quickCommands">
                {{ $t('settings.commandInputSync.targetQuickCommands', '快捷指令') }}
              </option>
              <option value="commandHistory">
                {{ $t('settings.commandInputSync.targetCommandHistory', '历史命令') }}
              </option>
            </select>
            <p class="text-xs text-text-secondary mt-1">
              {{
                $t(
                  'settings.commandInputSync.description',
                  '将命令输入框的内容实时同步到所选面板的搜索框。'
                )
              }}
            </p>
          </div>
          <div class="flex items-center justify-between">
            <button
              type="submit"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ $t('common.save') }}
            </button>
            <p
              v-if="commandInputSyncMessage"
              :class="['text-sm', commandInputSyncSuccess ? 'text-success' : 'text-error']"
            >
              {{ commandInputSyncMessage }}
            </p>
          </div>
        </form>
      </div>
      <hr class="border-border/50" />
      <!-- Show Connection Tags -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ $t('settings.workspace.showConnectionTagsTitle', '显示连接标签') }}
        </h3>
        <form @submit.prevent="handleUpdateShowConnectionTags" class="space-y-4">
          <div class="flex items-center">
            <input
              type="checkbox"
              id="showConnectionTags"
              v-model="showConnectionTagsLocal"
              class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
            />
            <label
              for="showConnectionTags"
              class="text-sm text-foreground cursor-pointer select-none"
              >{{ $t('settings.workspace.showConnectionTagsLabel', '在连接列表中显示标签') }}</label
            >
          </div>
          <p class="text-xs text-text-secondary mt-1">
            {{
              $t(
                'settings.workspace.showConnectionTagsDescription',
                '关闭后将隐藏连接列表中的标签，并从搜索中排除标签。'
              )
            }}
          </p>
          <div class="flex items-center justify-between pt-2">
            <button
              type="submit"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ $t('common.save') }}
            </button>
            <p
              v-if="showConnectionTagsMessage"
              :class="['text-sm', showConnectionTagsSuccess ? 'text-success' : 'text-error']"
            >
              {{ showConnectionTagsMessage }}
            </p>
          </div>
        </form>
      </div>
      <hr class="border-border/50" />
      <!-- Show Quick Command Tags -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ $t('settings.workspace.showQuickCommandTagsTitle', '显示快捷指令标签') }}
        </h3>
        <form @submit.prevent="handleUpdateShowQuickCommandTags" class="space-y-4">
          <div class="flex items-center">
            <input
              type="checkbox"
              id="showQuickCommandTags"
              v-model="showQuickCommandTagsLocal"
              class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
            />
            <label
              for="showQuickCommandTags"
              class="text-sm text-foreground cursor-pointer select-none"
              >{{
                $t('settings.workspace.showQuickCommandTagsLabel', '在快捷指令列表中显示标签')
              }}</label
            >
          </div>
          <p class="text-xs text-text-secondary mt-1">
            {{
              $t(
                'settings.workspace.showQuickCommandTagsDescription',
                '关闭后将隐藏快捷指令列表中的标签，并从搜索中排除标签。'
              )
            }}
          </p>
          <div class="flex items-center justify-between pt-2">
            <button
              type="submit"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ $t('common.save') }}
            </button>
            <p
              v-if="showQuickCommandTagsMessage"
              :class="['text-sm', showQuickCommandTagsSuccess ? 'text-success' : 'text-error']"
            >
              {{ showQuickCommandTagsMessage }}
            </p>
          </div>
        </form>
      </div>
      <hr class="border-border/50" />
      <!-- Terminal Scrollback Limit -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ t('settings.terminalScrollback.title', '终端回滚行数') }}
        </h3>
        <form @submit.prevent="handleUpdateTerminalScrollbackLimit" class="space-y-4">
          <div>
            <label
              for="terminalScrollbackLimitInput"
              class="block text-sm font-medium text-text-secondary mb-1"
              >{{ t('settings.terminalScrollback.limitLabel', '最大行数') }}</label
            >
            <input
              type="number"
              id="terminalScrollbackLimitInput"
              v-model.number="terminalScrollbackLimitLocal"
              min="0"
              step="1"
              placeholder="5000"
              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
            />
            <small class="block mt-1 text-xs text-text-secondary">{{
              t(
                'settings.terminalScrollback.limitHint',
                '设置终端保留的最大输出行数。0 或留空表示无限制 (使用默认值 5000)。此设置将在下次打开终端时生效。'
              )
            }}</small>
          </div>
          <div class="flex items-center justify-between">
            <button
              type="submit"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ t('common.save') }}
            </button>
            <p
              v-if="terminalScrollbackLimitMessage"
              :class="['text-sm', terminalScrollbackLimitSuccess ? 'text-success' : 'text-error']"
            >
              {{ terminalScrollbackLimitMessage }}
            </p>
          </div>
        </form>
      </div>
      <hr class="border-border/50" />
      <!-- File Manager Delete Confirmation -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ $t('settings.workspace.fileManagerDeleteConfirmTitle', '文件管理器删除确认') }}
        </h3>
        <form @submit.prevent="handleUpdateFileManagerDeleteConfirmation" class="space-y-4">
          <div class="flex items-center">
            <input
              type="checkbox"
              id="fileManagerShowDeleteConfirmation"
              v-model="fileManagerShowDeleteConfirmationLocal"
              class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
            />
            <label
              for="fileManagerShowDeleteConfirmation"
              class="text-sm text-foreground cursor-pointer select-none"
              >{{
                $t(
                  'settings.workspace.fileManagerShowDeleteConfirmationLabel',
                  '删除文件或文件夹时显示确认提示框'
                )
              }}</label
            >
          </div>
          <div class="flex items-center justify-between pt-2">
            <button
              type="submit"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ $t('common.save') }}
            </button>
            <p
              v-if="fileManagerShowDeleteConfirmationMessage"
              :class="[
                'text-sm',
                fileManagerShowDeleteConfirmationSuccess ? 'text-success' : 'text-error',
              ]"
            >
              {{ fileManagerShowDeleteConfirmationMessage }}
            </p>
          </div>
        </form>
      </div>
      <hr class="border-border/50" />
      <!-- Terminal Right Click Paste -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ $t('settings.workspace.terminalRightClickPasteTitle') }}
        </h3>
        <form @submit.prevent="handleUpdateTerminalRightClickPasteSetting" class="space-y-4">
          <div class="flex items-center">
            <input
              type="checkbox"
              id="terminalEnableRightClickPaste"
              v-model="terminalEnableRightClickPasteLocal"
              class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
            />
            <label
              for="terminalEnableRightClickPaste"
              class="text-sm text-foreground cursor-pointer select-none"
              >{{ $t('settings.workspace.terminalEnableRightClickPasteLabel') }}</label
            >
          </div>
          <p class="text-xs text-text-secondary mt-1">
            {{ $t('settings.workspace.terminalEnableRightClickPasteDescription') }}
          </p>
          <div class="flex items-center justify-between pt-2">
            <button
              type="submit"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ $t('common.save') }}
            </button>
            <p
              v-if="terminalEnableRightClickPasteMessage"
              :class="[
                'text-sm',
                terminalEnableRightClickPasteSuccess ? 'text-success' : 'text-error',
              ]"
            >
              {{ terminalEnableRightClickPasteMessage }}
            </p>
          </div>
        </form>
      </div>
      <hr class="border-border/50" />
      <!-- Terminal Output Enhancer -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ $t('settings.terminalOutputEnhancer.title') }}
        </h3>
        <form @submit.prevent="handleUpdateTerminalOutputEnhancerSetting" class="space-y-4">
          <div class="flex items-center">
            <input
              type="checkbox"
              id="terminalOutputEnhancer"
              v-model="terminalOutputEnhancerEnabled"
              class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
            />
            <label
              for="terminalOutputEnhancer"
              class="text-sm text-foreground cursor-pointer select-none"
              >{{ $t('settings.terminalOutputEnhancer.enableLabel') }}</label
            >
          </div>
          <p class="text-xs text-text-secondary mt-1">
            {{ $t('settings.terminalOutputEnhancer.description') }}
          </p>
          <div class="flex items-center justify-between pt-2">
            <button
              type="submit"
              :disabled="terminalOutputEnhancerLoading"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ $t('common.save') }}
            </button>
            <p
              v-if="terminalOutputEnhancerMessage"
              :class="['text-sm', terminalOutputEnhancerSuccess ? 'text-success' : 'text-error']"
            >
              {{ terminalOutputEnhancerMessage }}
            </p>
          </div>
        </form>
      </div>
      <hr class="border-border/50" />
      <!-- Status Monitor Show IP -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ $t('settings.statusMonitorShowIp.title', '状态监视器 IP 显示') }}
        </h3>
        <form @submit.prevent="handleUpdateStatusMonitorShowIpSetting" class="space-y-4">
          <div class="flex items-center">
            <input
              type="checkbox"
              id="statusMonitorShowIp"
              v-model="statusMonitorShowIpEnabled"
              class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
            />
            <label
              for="statusMonitorShowIp"
              class="text-sm text-foreground cursor-pointer select-none"
              >{{
                $t('settings.statusMonitorShowIp.enableLabel', '在状态监视器中显示IP地址')
              }}</label
            >
          </div>
          <div class="flex items-center justify-between pt-2">
            <button
              type="submit"
              :disabled="statusMonitorShowIpLoading"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ $t('common.save') }}
            </button>
            <p
              v-if="statusMonitorShowIpMessage"
              :class="['text-sm', statusMonitorShowIpSuccess ? 'text-success' : 'text-error']"
            >
              {{ statusMonitorShowIpMessage }}
            </p>
          </div>
        </form>
      </div>
      <hr class="border-border/50" />

      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ t('settings.statusMonitor.title') }}
        </h3>
        <form @submit.prevent="handleUpdateStatusMonitorInterval" class="space-y-4">
          <div>
            <label
              for="statusMonitorInterval"
              class="block text-sm font-medium text-text-secondary mb-1"
            >
              {{ t('settings.statusMonitor.refreshIntervalLabel') }}
            </label>
            <input
              type="number"
              id="statusMonitorInterval"
              v-model.number="statusMonitorIntervalLocal"
              min="1"
              step="1"
              required
              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
            />
            <small class="block mt-1 text-xs text-text-secondary">
              {{ t('settings.statusMonitor.refreshIntervalHint') }}
            </small>
          </div>
          <div class="flex items-center justify-between">
            <button
              type="submit"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ t('settings.statusMonitor.saveButton') }}
            </button>
            <p
              v-if="statusMonitorMessage"
              :class="['text-sm', statusMonitorSuccess ? 'text-success' : 'text-error']"
            >
              {{ statusMonitorMessage }}
            </p>
          </div>
        </form>
      </div>

      <hr class="border-border/50" />

      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ t('settings.docker.title') }}
        </h3>
        <form @submit.prevent="handleUpdateDockerSettings" class="space-y-4">
          <div>
            <label for="dockerInterval" class="block text-sm font-medium text-text-secondary mb-1">
              {{ t('settings.docker.refreshIntervalLabel') }}
            </label>
            <input
              type="number"
              id="dockerInterval"
              v-model.number="dockerInterval"
              min="1"
              step="1"
              required
              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
            />
            <small class="block mt-1 text-xs text-text-secondary">
              {{ t('settings.docker.refreshIntervalHint') }}
            </small>
          </div>
          <div class="flex items-center">
            <input
              type="checkbox"
              id="dockerExpandDefault"
              v-model="dockerExpandDefault"
              class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
            />
            <label
              for="dockerExpandDefault"
              class="text-sm text-foreground cursor-pointer select-none"
            >
              {{ t('settings.docker.defaultExpandLabel') }}
            </label>
          </div>
          <div class="flex items-center justify-between">
            <button
              type="submit"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ t('settings.docker.saveButton') }}
            </button>
            <p
              v-if="dockerSettingsMessage"
              :class="['text-sm', dockerSettingsSuccess ? 'text-success' : 'text-error']"
            >
              {{ dockerSettingsMessage }}
            </p>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingsStore } from '../../stores/settings.store';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useWorkspaceSettings } from '../../composables/settings/useWorkspaceSettings';
import { useSystemSettings } from '../../composables/settings/useSystemSettings';

const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore); // To ensure v-if="settings" works
const { t } = useI18n();

const workspaceSettings = useWorkspaceSettings();
const systemSettings = useSystemSettings();

const {
  popupEditorEnabled,
  popupEditorMessage,
  popupEditorSuccess,
  handleUpdatePopupEditorSetting,
  shareTabsEnabled,
  shareTabsMessage,
  shareTabsSuccess,
  handleUpdateShareTabsSetting,
  autoCopyEnabled,
  autoCopyMessage,
  autoCopySuccess,
  handleUpdateAutoCopySetting,
  workspaceSidebarPersistentEnabled,
  workspaceSidebarPersistentMessage,
  workspaceSidebarPersistentSuccess,
  handleUpdateWorkspaceSidebarSetting,
  commandInputSyncTargetLocal,
  commandInputSyncMessage,
  commandInputSyncSuccess,
  handleUpdateCommandInputSyncTarget,
  showConnectionTagsLocal,
  showConnectionTagsMessage,
  showConnectionTagsSuccess,
  handleUpdateShowConnectionTags,
  showQuickCommandTagsLocal,
  showQuickCommandTagsMessage,
  showQuickCommandTagsSuccess,
  handleUpdateShowQuickCommandTags,
  terminalScrollbackLimitLocal,
  terminalScrollbackLimitMessage,
  terminalScrollbackLimitSuccess,
  handleUpdateTerminalScrollbackLimit,
  fileManagerShowDeleteConfirmationLocal,
  fileManagerShowDeleteConfirmationMessage,
  fileManagerShowDeleteConfirmationSuccess,
  handleUpdateFileManagerDeleteConfirmation,
  terminalEnableRightClickPasteLocal,
  terminalEnableRightClickPasteLoading,
  terminalEnableRightClickPasteMessage,
  terminalEnableRightClickPasteSuccess,
  handleUpdateTerminalRightClickPasteSetting,
  showPopupFileManagerLocal,
  showPopupFileManagerMessage,
  showPopupFileManagerSuccess,
  handleUpdateShowPopupFileManager,
  statusMonitorShowIpEnabled,
  statusMonitorShowIpLoading,
  statusMonitorShowIpMessage,
  statusMonitorShowIpSuccess,
  handleUpdateStatusMonitorShowIpSetting,
  terminalOutputEnhancerEnabled,
  terminalOutputEnhancerLoading,
  terminalOutputEnhancerMessage,
  terminalOutputEnhancerSuccess,
  handleUpdateTerminalOutputEnhancerSetting,
} = workspaceSettings;

const {
  statusMonitorIntervalLocal,
  statusMonitorMessage,
  statusMonitorSuccess,
  handleUpdateStatusMonitorInterval,
  dockerInterval,
  dockerExpandDefault,
  dockerSettingsMessage,
  dockerSettingsSuccess,
  handleUpdateDockerSettings,
} = systemSettings;
</script>
