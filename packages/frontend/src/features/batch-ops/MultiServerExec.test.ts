import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import MultiServerExec from './MultiServerExec.vue';

// Mock i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

// Mock BatchStore
vi.mock('../../stores/batch.store', () => ({
    useBatchStore: () => ({
        currentTask: null,
        error: null,
        isExecuting: false,
        getConnectionStatus: () => null,
        clearError: vi.fn(),
    }),
}));

// Mock ConnectionsStore
vi.mock('../../stores/connections.store', () => ({
    useConnectionsStore: () => ({
        connections: [
            { id: 1, name: 'S1', type: 'SSH' },
            { id: 2, name: 'R1', type: 'RDP' },
        ],
        fetchConnections: vi.fn(),
    }),
}));

describe('MultiServerExec.vue', () => {
  it('filters connections to show only SSH types', () => {
    setActivePinia(createPinia());

    const wrapper = mount(MultiServerExec, {
      global: {
        stubs: {
            StatusBadge: true, 
            StatusIcon: true
        }
      }
    });

    const vm = wrapper.vm as any;
    // Check computed property 'connections'
    expect(vm.connections).toHaveLength(1);
    expect(vm.connections[0].type).toBe('SSH');
  });
});
