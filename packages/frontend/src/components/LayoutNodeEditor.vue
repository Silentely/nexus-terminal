<script setup lang="ts">
import { computed, type PropType } from 'vue';
import { useI18n } from 'vue-i18n';
import draggable from 'vuedraggable';
import { useLayoutStore, type LayoutNode, type PaneName } from '../stores/layout.store';

// --- Props ---
const props = defineProps({
  node: {
    type: Object as PropType<LayoutNode>,
    required: true,
  },
  // 接收父节点信息，用于删除等操作
  parentNode: {
    type: Object as PropType<LayoutNode | null>,
    default: null,
  },
  // 接收当前节点在父节点 children 中的索引
  nodeIndex: {
    type: Number,
    default: -1,
  },
  // 接收来自父组件的面板标签
  paneLabels: {
    type: Object as PropType<Record<PaneName, string>>,
    required: true,
  },
});

// --- Emits ---
// 定义需要向上层（LayoutConfigurator）传递的事件
const emit = defineEmits(['update:node', 'removeNode']);

// --- Setup ---
const { t } = useI18n();
const layoutStore = useLayoutStore();

// --- Computed ---
// 计算当前节点的子节点列表（用于 v-model）
// 注意：直接修改 props 是不允许的，vuedraggable 需要一个可写的 list
// 我们通过 emit 事件来通知父组件更新
const childrenList = computed({
  get: () => props.node.children || [],
  set: (newChildren) => {
    // 当 vuedraggable 修改列表时，它应该直接修改绑定的列表 (props.node.children)
    // 移除下面的 emit 调用，因为它导致了事件风暴
    // emit('update:node', { ...props.node, children: newChildren });
    // 添加日志以确认 setter 被调用，并依赖 vuedraggable 的直接修改
    console.log(
      '[LayoutNodeEditor] childrenList setter called, relying on v-model/vuedraggable mutation.'
    );
  },
});

// --- Methods ---
// 添加水平分割容器
const addHorizontalContainer = () => {
  const newNode: LayoutNode = {
    id: layoutStore.generateId(),
    type: 'container',
    direction: 'horizontal',
    children: [], // 新容器初始为空
    size: 50, // 默认大小
  };
  const updatedChildren = [...(props.node.children || []), newNode];
  emit('update:node', { ...props.node, children: updatedChildren });
};

// 添加垂直分割容器
const addVerticalContainer = () => {
  const newNode: LayoutNode = {
    id: layoutStore.generateId(),
    type: 'container',
    direction: 'vertical',
    children: [],
    size: 50,
  };
  const updatedChildren = [...(props.node.children || []), newNode];
  emit('update:node', { ...props.node, children: updatedChildren });
};

// 移除当前节点
const removeSelf = () => {
  emit('removeNode', { parentNodeId: props.parentNode?.id, nodeIndex: props.nodeIndex });
};

// 切换容器方向
const toggleDirection = () => {
  if (props.node.type === 'container') {
    const newDirection = props.node.direction === 'horizontal' ? 'vertical' : 'horizontal';
    emit('update:node', { ...props.node, direction: newDirection });
  }
};

// 处理子节点更新事件（由递归调用发出）
const handleChildUpdate = (updatedChildNode: LayoutNode, index: number) => {
  if (props.node.children) {
    const newChildren = [...props.node.children];
    newChildren[index] = updatedChildNode;
    emit('update:node', { ...props.node, children: newChildren });
  }
};

// 处理子节点移除事件
const handleChildRemove = (payload: { parentNodeId: string | undefined; nodeIndex: number }) => {
  // 总是将移除事件向上传递，让顶层 LayoutConfigurator 处理
  console.log(`[LayoutNodeEditor ${props.node.id}] Relaying removeNode event upwards:`, payload);
  emit('removeNode', payload);
};
</script>

<template>
  <div
    class="layout-node-editor"
    :class="[`node-type-${node.type}`, node.direction ? `direction-${node.direction}` : '']"
    :data-node-id="node.id"
  >
    <!-- 节点控制栏 -->
    <div class="node-controls">
      <span class="node-info">
        {{
          node.type === 'pane'
            ? props.paneLabels[node.component!] || node.component
            : t('layoutNodeEditor.containerLabel', {
                direction:
                  node.direction === 'horizontal'
                    ? t('layoutNodeEditor.horizontal')
                    : t('layoutNodeEditor.vertical'),
              })
        }}
      </span>
      <div class="node-actions">
        <button
          v-if="node.type === 'container'"
          @click="toggleDirection"
          :title="t('layoutNodeEditor.toggleDirection')"
          class="action-button"
        >
          <i class="fas fa-sync-alt"></i>
        </button>
        <button
          v-if="node.type === 'container'"
          @click="addHorizontalContainer"
          :title="t('layoutNodeEditor.addHorizontalContainer')"
          class="action-button"
        >
          <i class="fas fa-columns"></i> H
        </button>
        <button
          v-if="node.type === 'container'"
          @click="addVerticalContainer"
          :title="t('layoutNodeEditor.addVerticalContainer')"
          class="action-button"
        >
          <i class="fas fa-bars"></i> V
        </button>
        <button
          @click="removeSelf"
          :title="t('layoutNodeEditor.removeNode')"
          class="action-button remove-button"
          :disabled="!parentNode"
        >
          <i class="fas fa-trash-alt"></i>
        </button>
      </div>
    </div>

    <!-- 如果是容器节点，使用 draggable 渲染子节点 -->
    <draggable
      v-if="node.type === 'container'"
      :list="childrenList"
      @update:list="childrenList = $event"
      tag="div"
      class="node-children-container"
      :class="[`children-direction-${node.direction}`]"
      item-key="id"
      group="layout-items"
      handle=".drag-handle-node"
    >
      <template #item="{ element: childNode, index }">
        <div class="child-node-wrapper" :key="childNode.id">
          <i
            class="fas fa-grip-vertical drag-handle-node"
            :title="t('layoutNodeEditor.dragHandle')"
          ></i>

          <LayoutNodeEditor
            :node="childNode"
            :parent-node="node"
            :node-index="index"
            :pane-labels="props.paneLabels"
            @update:node="handleChildUpdate($event, index)"
            @removeNode="handleChildRemove"
          />
        </div>
      </template>
      <!-- 容器为空时的占位符 -->
      <template #footer>
        <div v-if="!childrenList || childrenList.length === 0" class="empty-container-placeholder">
          {{ t('layoutNodeEditor.dropHere') }}
        </div>
      </template>
    </draggable>

    <!-- 如果是面板节点，只显示信息（因为内容在主视图渲染） -->
    <div v-else class="pane-node-content">
      <!-- 面板节点在配置器中通常不需要显示内容 -->
    </div>
  </div>
</template>

<style scoped>
.layout-node-editor {
}

.node-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: var(--header-bg-color);
  padding: 3px var(--base-margin);
  margin-bottom: var(--base-margin);
  font-size: 0.8em;
  min-height: 24px; /* 确保控制栏有高度 */
}

.node-info {
  font-weight: bold;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 10px;
}

.node-actions {
  display: flex;
  gap: 3px;
}

.action-button {
  background: none;
  border: 1px solid var(--border-color);
  border-radius: 3px;
  cursor: pointer;
  padding: 1px 4px;
  font-size: 0.9em;
  line-height: 1;
}
.action-button:hover {
  background-color: var(
    --border-color
  ); /* Consider a dedicated var(--button-hover-light-bg-color) */
}
.remove-button {
  color: #dc3545; /* Consider var(--danger-color) */
  border-color: #dc3545; /* Consider var(--danger-color) */
}
.remove-button:hover {
  background-color: #dc3545; /* Consider var(--danger-bg-color) */
  color: var(--button-text-color);
}

.node-children-container {
  flex-grow: 1;
  padding: var(--base-margin);
  border: 1px dashed var(--border-color); /* 容器内部边框 */
  min-height: 40px; /* Keep specific height or make variable */
  display: flex;
}
.children-direction-horizontal {
  flex-direction: row;
}
.children-direction-vertical {
  flex-direction: column;
}

.child-node-wrapper {
  border: 1px solid transparent; /* 占位，防止抖动 */
  position: relative; /* 用于定位拖拽句柄 */
  display: flex; /* 让句柄和内容并排 */
  align-items: stretch; /* 让子项高度一致 */
}
/* 根据方向调整子项的 flex 属性 */
.children-direction-horizontal > .child-node-wrapper {
  flex: 1 1 auto; /* 水平方向允许伸缩 */
  flex-direction: column; /* 内部还是列方向 */
}
.children-direction-vertical > .child-node-wrapper {
  width: 100%; /* 垂直方向占满宽度 */
  flex-direction: row; /* 内部行方向 */
  align-items: center;
}

.drag-handle-node {
  cursor: grab;
  color: var(--text-color-secondary);
  padding: var(--base-margin) 3px; /* 增加点击区域 */
  background-color: var(--header-bg-color); /* Or a specific handle background */
  border-right: 1px solid var(--border-color); /* 垂直句柄 */
}
.children-direction-vertical > .child-node-wrapper > .drag-handle-node {
  border-right: none;
  border-bottom: 1px solid var(--border-color); /* 水平句柄 */
  writing-mode: vertical-rl; /* 可选：旋转图标 */
}

.child-node-wrapper > .layout-node-editor {
  flex-grow: 1; /* 让递归组件填充剩余空间 */
  margin: 0; /* 移除递归组件的外边距 */
  border: none; /* 移除递归组件的边框 */
  padding: 0; /* 移除递归组件的内边距 */
}

.pane-node-content {
  /* 面板节点在配置器中通常是空的 */
  min-height: 30px; /* Keep specific height or make variable */
  text-align: center;
  color: var(--text-color-secondary);
  font-size: 0.8em;
  padding-top: var(--base-margin);
}

.empty-container-placeholder {
  flex-grow: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  text-align: center;
  color: var(--text-color-secondary);
  font-size: 0.9em;
  min-height: 30px; /* Keep specific height or make variable */
  padding: calc(var(--base-padding) / 2); /* Or specific padding */
  border: 1px dashed var(--border-color);
  margin: var(--base-margin); /* 与 layout-node-editor 的 margin 匹配 */
}

/* vuedraggable 拖拽时的样式 */
.sortable-ghost {
  opacity: 0.4;
  background-color: var(--link-active-bg-color) !important; /* 拖拽占位符样式 */
  border: 1px dashed var(--link-active-color);
}
.sortable-chosen {
  /* 被选中的元素样式 */
}
.sortable-drag {
  /* 正在拖拽的元素样式 */
}
</style>
