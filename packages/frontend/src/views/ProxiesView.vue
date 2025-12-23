<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useProxiesStore, ProxyInfo } from '../stores/proxies.store';
import ProxyList from '../components/ProxyList.vue';
import AddProxyForm from '../components/AddProxyForm.vue';

const { t } = useI18n();
const proxiesStore = useProxiesStore();

const showForm = ref(false);
const editingProxy = ref<ProxyInfo | null>(null);

// 组件挂载时获取代理列表
onMounted(() => {
  proxiesStore.fetchProxies();
});

const handleProxyAdded = () => {
  showForm.value = false;
};

const handleProxyUpdated = () => {
  editingProxy.value = null;
  showForm.value = false;
};

const handleEditRequest = (proxy: ProxyInfo) => {
  editingProxy.value = proxy;
  showForm.value = true;
};

const openAddForm = () => {
  editingProxy.value = null;
  showForm.value = true;
};

const closeForm = () => {
  editingProxy.value = null;
  showForm.value = false;
};
</script>

<template>
  <div class="p-4 bg-background text-foreground">
    <!-- Outer container with padding -->
    <div class="max-w-6xl mx-auto">
      <!-- Inner container for max-width and centering -->
      <h2 class="text-xl font-semibold text-foreground mb-4 pb-2 border-b border-border">
        <!-- Title styling consistent with Notifications -->
        {{ t('proxies.title') }}
      </h2>

      <button
        @click="openAddForm"
        v-if="!showForm"
        class="px-4 py-2 bg-button text-button-text rounded hover:bg-button-hover mb-4 inline-flex items-center text-sm font-medium"
      >
        <!-- Button styling consistent with Notifications -->
        {{ t('proxies.addProxy') }}
      </button>

      <!-- 添加/编辑代理表单 -->
      <AddProxyForm
        v-if="showForm"
        :proxy-to-edit="editingProxy"
        @close="closeForm"
        @proxy-added="handleProxyAdded"
        @proxy-updated="handleProxyUpdated"
      />

      <!-- 代理列表 -->
      <ProxyList @edit-proxy="handleEditRequest" />
    </div>
  </div>
</template>

<style scoped>
/* Remove scoped styles previously handled by Tailwind */
/* .proxies-view, button, button:hover, button:disabled, .placeholder-form, .placeholder-list rules are removed */
</style>
