<template>
  <div class="settings-section-content">
    <h3 class="text-base font-semibold text-foreground mb-3">{{ $t('settings.passkey.title') }}</h3>
    <p class="text-sm text-text-secondary mb-4">{{ $t('settings.passkey.description') }}</p>
    <button
      @click="handleRegisterNewPasskey"
      :disabled="passkeyLoading"
      class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium"
    >
      {{ passkeyLoading ? $t('common.loading') : $t('settings.passkey.registerNewButton') }}
    </button>
    <p
      v-if="passkeyMessage"
      :class="['mt-3 text-sm', passkeySuccess ? 'text-success' : 'text-error']"
    >
      {{ passkeyMessage }}
    </p>

    <!-- Display list of registered passkeys -->
    <div class="mt-6">
      <h4 class="text-base font-semibold text-foreground mb-3">
        {{ $t('settings.passkey.registeredKeysTitle') }}
      </h4>
      <div v-if="authStorePasskeysLoading" class="p-4 text-center text-text-secondary italic">
        {{ $t('common.loading') }}
      </div>
      <div v-else-if="passkeys && passkeys.length > 0">
        <ul class="space-y-3">
          <li
            v-for="key in passkeys"
            :key="key.credentialID"
            class="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 border border-border rounded-md bg-header/20 hover:bg-header/40 transition-colors duration-150"
          >
            <div class="flex-grow mb-2 sm:mb-0">
              <div class="flex items-center">
                <span
                  v-if="!editingPasskeyId || editingPasskeyId !== key.credentialID"
                  class="block font-medium text-foreground text-sm"
                >
                  {{ key.name || $t('settings.passkey.unnamedKey') }}
                  <span class="text-xs text-text-tertiary ml-1"
                    >(ID: ...{{
                      typeof key.credentialID === 'string' && key.credentialID
                        ? key.credentialID.slice(-8)
                        : 'N/A'
                    }})</span
                  >
                </span>
                <div v-else class="flex items-center flex-grow">
                  <input
                    type="text"
                    v-model="editingPasskeyName"
                    @keyup.enter="savePasskeyName(key.credentialID)"
                    @keyup.esc="cancelEditPasskeyName"
                    class="w-48 px-2 py-1 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-sm"
                    :placeholder="$t('settings.passkey.enterNamePlaceholder', '输入 Passkey 名称')"
                  />
                  <button
                    @click="savePasskeyName(key.credentialID)"
                    :disabled="passkeyEditLoadingStates[key.credentialID]"
                    class="ml-2 px-2 py-1 bg-success text-success-text rounded-md text-xs font-medium hover:bg-success/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-success disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
                  >
                    {{
                      passkeyEditLoadingStates[key.credentialID]
                        ? $t('common.saving')
                        : $t('common.save')
                    }}
                  </button>
                  <button
                    @click="cancelEditPasskeyName"
                    :disabled="passkeyEditLoadingStates[key.credentialID]"
                    class="ml-1 px-2 py-1 bg-transparent text-text-secondary border border-border rounded-md text-xs font-medium hover:bg-border hover:text-foreground focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
                  >
                    {{ $t('common.cancel') }}
                  </button>
                </div>
                <button
                  v-if="!editingPasskeyId || editingPasskeyId !== key.credentialID"
                  @click="startEditPasskeyName(key.credentialID, key.name || '')"
                  class="ml-2 p-1 text-text-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out"
                  :title="$t('settings.passkey.editNameTooltip', '编辑名称')"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    fill="currentColor"
                    viewBox="0 0 16 16"
                    class="bi bi-pencil-square"
                  >
                    <path
                      d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"
                    />
                    <path
                      fill-rule="evenodd"
                      d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5v11z"
                    />
                  </svg>
                </button>
              </div>
              <div class="text-xs text-text-secondary mt-1 space-x-2">
                <span
                  >{{ $t('settings.passkey.createdDate') }}:
                  {{ formatDate(key.creationDate) }}</span
                >
                <span v-if="key.lastUsedDate"
                  >{{ $t('settings.passkey.lastUsedDate') }}:
                  {{ formatDate(key.lastUsedDate) }}</span
                >
                <span v-if="key.transports && key.transports.length > 0" class="capitalize"
                  >({{ key.transports.join(', ') }})</span
                >
              </div>
            </div>
            <button
              @click="handleDeletePasskey(key.credentialID)"
              :disabled="
                passkeyDeleteLoadingStates[key.credentialID] ||
                editingPasskeyId === key.credentialID
              "
              class="px-3 py-1.5 bg-error text-error-text rounded-md text-xs font-medium hover:bg-error/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-error disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out self-start sm:self-center"
            >
              {{
                passkeyDeleteLoadingStates[key.credentialID]
                  ? $t('common.loading')
                  : $t('common.delete')
              }}
            </button>
          </li>
        </ul>
      </div>
      <p v-else class="text-sm text-text-secondary italic">
        {{ $t('settings.passkey.noKeysRegistered') }}
      </p>
      <p v-if="passkeyDeleteError" class="mt-3 text-sm text-error">{{ passkeyDeleteError }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { usePasskeyManagement } from '../../composables/settings/usePasskeyManagement';

// const { t } = useI18n(); // $t is globally available in template

const {
  passkeys,
  passkeysLoading: authStorePasskeysLoading,
  passkeyRegistrationLoading: passkeyLoading, // Aliased for template compatibility
  passkeyMessage,
  passkeySuccess,
  passkeyDeleteLoadingStates,
  passkeyDeleteError,
  editingPasskeyId,
  editingPasskeyName,
  passkeyEditLoadingStates,
  handleRegisterNewPasskey,
  startEditPasskeyName,
  cancelEditPasskeyName,
  savePasskeyName,
  handleDeletePasskey,
  formatDate,
} = usePasskeyManagement();
</script>

<style scoped>
/* Styles specific to PasskeyManagement if any */
</style>
