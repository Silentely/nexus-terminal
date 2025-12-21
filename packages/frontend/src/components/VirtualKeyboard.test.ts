import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import VirtualKeyboard from './VirtualKeyboard.vue';

describe('VirtualKeyboard.vue', () => {
  it('emits send-key event when a key is clicked', async () => {
    const wrapper = mount(VirtualKeyboard);
    
    const buttons = wrapper.findAll('button');
    const escButton = buttons.find(b => b.text() === 'Esc');
    
    expect(escButton).toBeDefined();
    if (escButton) {
        await escButton.trigger('click');
        expect(wrapper.emitted('send-key')).toBeTruthy();
        expect(wrapper.emitted('send-key')?.[0]).toEqual(['\x1b']);
    }
  });
});
