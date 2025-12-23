<script setup lang="ts">
import { ref, reactive, watch, computed, onMounted } from 'vue'; // 添加 onMounted
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useProxiesStore, ProxyInfo } from '../stores/proxies.store';
import { useTagsStore } from '../stores/tags.store';
import TagInput from './TagInput.vue';

// 定义组件发出的事件
const emit = defineEmits(['close', 'proxy-added', 'proxy-updated']);

// 定义 Props
const props = defineProps<{
  proxyToEdit: ProxyInfo | null; // 接收要编辑的代理对象
}>();

const { t } = useI18n();
const proxiesStore = useProxiesStore();
const tagsStore = useTagsStore(); // 获取标签 store 实例
const { isLoading, error: proxyStoreError } = storeToRefs(proxiesStore); // 重命名 error 避免冲突
const { isLoading: isTagLoading, error: tagStoreError } = storeToRefs(tagsStore); // 获取标签状态

// 表单数据模型
const initialFormData = {
  name: '',
  type: 'SOCKS5' as 'SOCKS5' | 'HTTP',
  host: '',
  port: 1080, // 默认 SOCKS5 端口
  username: '',
  password: '',
  tag_ids: [] as number[],
};
const formData = reactive({ ...initialFormData });

const formError = ref<string | null>(null); // 表单级别的错误信息
// 合并加载和错误状态
const isCombinedLoading = computed(() => isLoading.value || isTagLoading.value);
const combinedStoreError = computed(() => proxyStoreError.value || tagStoreError.value);

// 计算属性判断是否为编辑模式
const isEditMode = computed(() => !!props.proxyToEdit);

// 计算属性动态设置表单标题
const formTitle = computed(() => {
  return isEditMode.value ? t('proxies.form.titleEdit') : t('proxies.form.title');
});

// 计算属性动态设置提交按钮文本
const submitButtonText = computed(() => {
  if (isLoading.value) {
    return isEditMode.value ? t('proxies.form.saving') : t('proxies.form.adding');
  }
  return isEditMode.value ? t('proxies.form.confirmEdit') : t('proxies.form.confirm');
});

// 监听 prop 变化以填充或重置表单
watch(
  () => props.proxyToEdit,
  (newVal) => {
    formError.value = null; // 清除错误
    if (newVal) {
      // 编辑模式：填充表单，但不填充密码
      formData.name = newVal.name;
      formData.type = newVal.type;
      formData.host = newVal.host;
      formData.port = newVal.port;
      formData.username = newVal.username ?? '';
      formData.password = ''; // 清空密码，要求用户重新输入以更新
    } else {
      // 添加模式：重置表单
      Object.assign(formData, initialFormData);
    }
  },
  { immediate: true }
);

// 处理表单提交
const handleSubmit = async () => {
  formError.value = null;
  proxiesStore.error = null;

  // 基础前端验证 (保持不变)
  if (!formData.name || !formData.host || !formData.port) {
    formError.value = t('proxies.form.errorRequiredFields');
    return;
  }
  if (formData.port <= 0 || formData.port > 65535) {
    formError.value = t('proxies.form.errorPort');
    return;
  }

  // 构建要发送的数据
  const dataToSend: any = {
    name: formData.name,
    type: formData.type,
    host: formData.host,
    port: formData.port,
    username: formData.username || null, // 如果为空字符串则发送 null
  };

  // 处理密码字段
  // 仅当用户输入新密码或在编辑模式下明确清空时才发送
  if (formData.password) {
    dataToSend.password = formData.password;
  } else if (isEditMode.value && formData.password === '') {
    dataToSend.password = null; // 发送 null 表示清空密码 (后端需要能处理 null)
  }
  // 如果是添加模式且密码为空，则不发送 password 字段

  let success = false;
  if (isEditMode.value && props.proxyToEdit) {
    success = await proxiesStore.updateProxy(props.proxyToEdit.id, dataToSend);
    if (success) {
      emit('proxy-updated');
    } else {
      formError.value = t('proxies.form.errorUpdate', { error: proxiesStore.error || '未知错误' });
    }
  } else {
    success = await proxiesStore.addProxy(dataToSend);
    if (success) {
      emit('proxy-added');
    } else {
      formError.value = t('proxies.form.errorAdd', { error: proxiesStore.error || '未知错误' });
    }
  }
};
</script>

<template>
  <div class="fixed inset-0 bg-overlay flex justify-center items-center z-50">
    <!-- Use bg-overlay for the overlay -->
    <div
      class="bg-background text-foreground p-8 rounded-lg shadow-xl border border-border min-w-[350px] max-w-lg"
    >
      <!-- Form Panel with Tailwind -->
      <h3 class="text-lg font-semibold text-center mb-6">{{ formTitle }}</h3>
      <!-- Title with Tailwind -->
      <form @submit.prevent="handleSubmit" class="space-y-4">
        <!-- Form with spacing -->
        <div>
          <!-- Form Group -->
          <label for="proxy-name" class="block text-sm font-medium text-text-secondary mb-1">{{
            t('proxies.form.name')
          }}</label>
          <input
            type="text"
            id="proxy-name"
            v-model="formData.name"
            required
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>
        <div>
          <!-- Form Group -->
          <label for="proxy-type" class="block text-sm font-medium text-text-secondary mb-1">{{
            t('proxies.form.type')
          }}</label>
          <select
            id="proxy-type"
            v-model="formData.type"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8"
            style="
              background-image: url(&quot;data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M2 5l6 6 6-6'/%3e%3c/svg%3e&quot;);
              background-position: right 0.75rem center;
              background-size: 16px 12px;
            "
          >
            <option value="SOCKS5">SOCKS5</option>
            <option value="HTTP">HTTP</option>
          </select>
        </div>
        <div>
          <!-- Form Group -->
          <label for="proxy-host" class="block text-sm font-medium text-text-secondary mb-1">{{
            t('proxies.form.host')
          }}</label>
          <input
            type="text"
            id="proxy-host"
            v-model="formData.host"
            required
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>
        <div>
          <!-- Form Group -->
          <label for="proxy-port" class="block text-sm font-medium text-text-secondary mb-1">{{
            t('proxies.form.port')
          }}</label>
          <input
            type="number"
            id="proxy-port"
            v-model.number="formData.port"
            required
            min="1"
            max="65535"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>
        <div>
          <!-- Form Group -->
          <label for="proxy-username" class="block text-sm font-medium text-text-secondary mb-1"
            >{{ t('proxies.form.username') }} ({{ t('proxies.form.optional') }})</label
          >
          <input
            type="text"
            id="proxy-username"
            v-model="formData.username"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>
        <div>
          <!-- Form Group -->
          <label for="proxy-password" class="block text-sm font-medium text-text-secondary mb-1"
            >{{ t('proxies.form.password') }} ({{ t('proxies.form.optional') }})</label
          >
          <input
            type="password"
            id="proxy-password"
            v-model="formData.password"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
          <small v-if="isEditMode" class="block mt-1 text-xs text-text-secondary">{{
            t('proxies.form.passwordUpdateNote')
          }}</small>
        </div>

        <div
          v-if="formError || combinedStoreError"
          class="text-error bg-error/10 border border-error/30 rounded-md p-3 text-sm text-center font-medium"
        >
          <!-- Use semantic error colors -->
          {{ formError || combinedStoreError }}
        </div>

        <div class="flex justify-end space-x-3 pt-5 mt-6 border-t border-border">
          <!-- Form Actions with Tailwind -->
          <button
            type="submit"
            :disabled="isLoading"
            class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
          >
            {{ submitButtonText }}
          </button>
          <button
            type="button"
            @click="emit('close')"
            :disabled="isLoading"
            class="px-4 py-2 bg-transparent text-text-secondary border border-border rounded-md shadow-sm hover:bg-border hover:text-foreground focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
          >
            {{ t('proxies.form.cancel') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
/* Remove all scoped styles as they are now handled by Tailwind utility classes */
</style>
